"""Tests for the RunPod handler dispatch + webhook callback shape.

Stages, R2, and HTTP are all monkeypatched. We're verifying:
  - The handler validates input shape and fails loud on missing fields.
  - It dispatches to the right stage function per `stage`.
  - The webhook payload it would POST has the shape the api receiver expects.
  - On stage exception, it posts a failed callback AND re-raises.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from subtitle_worker import handler as handler_mod
from subtitle_worker.stages.asr import TranscriptSegment


@pytest.fixture(autouse=True)
def secret_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WORKER_WEBHOOK_SECRET", "test-secret-do-not-use-in-prod")


class WebhookSpy:
    """Records every post_signed_json call without doing real HTTP."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def __call__(self, url: str, payload: dict[str, Any], secret: str, **kw: Any) -> None:
        self.calls.append({"url": url, "payload": payload, "secret": secret})


@pytest.fixture
def webhook_spy(monkeypatch: pytest.MonkeyPatch) -> WebhookSpy:
    spy = WebhookSpy()
    monkeypatch.setattr(handler_mod, "post_signed_json", spy)
    return spy


@pytest.fixture
def stub_r2(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[Any]]:
    """Replace R2 upload/download with in-memory no-ops; record calls."""
    log: dict[str, list[Any]] = {"uploads": [], "downloads": []}

    def _upload(local: Path, bucket: str, key: str) -> None:
        log["uploads"].append({"local": str(local), "bucket": bucket, "key": key})

    def _download(bucket: str, key: str, local: Path) -> None:
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_bytes(b"stub r2 download bytes")
        log["downloads"].append({"bucket": bucket, "key": key, "local": str(local)})

    monkeypatch.setattr(handler_mod, "upload_file", _upload)
    monkeypatch.setattr(handler_mod, "download_to_file", _download)
    return log


def _fake_http_download(url: str, work_dir: Path, hint: str) -> Path:
    """Replacement for `_download_http` in tests — writes a real file and
    returns its Path. Previously this was an obfuscated lambda that returned
    `int` (the `Path.write_bytes` return value); tests passed only because
    the downstream stage stubs ignored the value.
    """
    target = work_dir / f"in_{hint}"
    target.write_bytes(b"stub http download bytes")
    return target


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------


def test_missing_input_keys_raises_before_doing_work(webhook_spy: WebhookSpy) -> None:
    with pytest.raises(ValueError, match="missing required input keys"):
        handler_mod.handler({"input": {"stage": "preprocess"}})
    # And critically: no webhook was sent (the missing-fields case can't
    # reach the success/failure callback because we don't even have the URL).
    assert webhook_spy.calls == []


def test_unsupported_stage_raises_without_posting_callback(webhook_spy: WebhookSpy) -> None:
    # Unsupported stage is a DISPATCHER bug — the api's worker-runner is
    # gated to known stages. If we got one anyway, NOT posting a failure
    # callback is correct: failing the episode for a routing bug would
    # mask the real problem.
    with pytest.raises(ValueError, match="unsupported stage"):
        handler_mod.handler({
            "input": {
                "stage": "publish",  # not handled by the worker
                "episodeId": "ep-1",
                "eventId": "ep-1:publish:run-1",
                "pipelineRunId": "run-1",
                "webhookUrl": "https://api.example/webhooks/runpod",
            }
        })
    assert webhook_spy.calls == []


def test_missing_webhook_secret_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WORKER_WEBHOOK_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="WORKER_WEBHOOK_SECRET"):
        handler_mod.handler({
            "input": {
                "stage": "preprocess",
                "episodeId": "ep-1",
                "eventId": "ep-1:preprocess:run-1",
                "pipelineRunId": "run-1",
                "webhookUrl": "https://api.example/webhooks/runpod",
                "sourceUrl": "https://example/in.mkv",
            }
        })


# ---------------------------------------------------------------------------
# Dispatch + success callback
# ---------------------------------------------------------------------------


def test_preprocess_dispatch_posts_completed_callback_with_audio_key(
    monkeypatch: pytest.MonkeyPatch,
    webhook_spy: WebhookSpy,
    stub_r2: dict[str, list[Any]],
    tmp_path: Path,
) -> None:
    def fake_preprocess(source: Path, work_dir: Path) -> Path:
        out = work_dir / "trimmed.wav"
        out.write_bytes(b"stub trimmed audio")
        return out

    monkeypatch.setattr(handler_mod, "preprocess_for_asr", fake_preprocess)
    monkeypatch.setattr(handler_mod, "_download_http", _fake_http_download)

    result = handler_mod.handler({
        "input": {
            "stage": "preprocess",
            "episodeId": "ep-1",
            "eventId": "ep-1:preprocess:run-1",
            "pipelineRunId": "run-1",
            "webhookUrl": "https://api.example/webhooks/runpod",
            "sourceUrl": "https://example/in.mkv",
        }
    })

    assert result["status"] == "completed"
    assert result["stage"] == "preprocess"
    assert result["output"] == {"audioKey": "stage/preprocess/ep-1.wav"}

    assert len(webhook_spy.calls) == 1
    payload = webhook_spy.calls[0]["payload"]
    assert payload["status"] == "completed"
    assert payload["stage"] == "preprocess"
    assert payload["eventId"] == "ep-1:preprocess:run-1"
    assert payload["pipelineRunId"] == "run-1"
    assert payload["output"] == {"audioKey": "stage/preprocess/ep-1.wav"}

    # Upload happened to the right bucket + key.
    assert len(stub_r2["uploads"]) == 1
    assert stub_r2["uploads"][0]["key"] == "stage/preprocess/ep-1.wav"


def test_transcribe_dispatch_routes_full_key_to_media_bucket(
    monkeypatch: pytest.MonkeyPatch,
    webhook_spy: WebhookSpy,
    stub_r2: dict[str, list[Any]],
) -> None:
    def fake_isolate(audio: Path, work_dir: Path):  # noqa: ANN001
        from subtitle_worker.stages.vocals import VocalsOutput

        vocals = work_dir / "vocals.wav"
        vocals.write_bytes(b"stub vocals")
        return VocalsOutput(vocals_path=vocals, model="stub")

    def fake_transcribe(audio: Path) -> list[TranscriptSegment]:
        return [TranscriptSegment(start_ms=0, end_ms=1000, text="hi", confidence=0.9)]

    monkeypatch.setattr(handler_mod, "isolate_vocals", fake_isolate)
    monkeypatch.setattr(handler_mod, "transcribe_audio", fake_transcribe)

    handler_mod.handler({
        "input": {
            "stage": "transcribe",
            "episodeId": "ep-2",
            "eventId": "ep-2:transcribe:run-1",
            "pipelineRunId": "run-1",
            "webhookUrl": "https://api.example/webhooks/runpod",
            "audioUrl": "stage/preprocess/ep-2.wav",  # bare key, not URL
        }
    })

    assert webhook_spy.calls[0]["payload"]["output"] == {
        "transcriptKey": "stage/transcribe/ep-2.json"
    }
    # Critical: the full multi-segment key goes to the media bucket as-is.
    # A previous heuristic would mis-parse `stage/preprocess/ep-2.wav` as
    # bucket="stage", key="preprocess/ep-2.wav" — which would hit a
    # non-existent bucket.
    assert len(stub_r2["downloads"]) == 1
    assert stub_r2["downloads"][0]["bucket"] == "subtitle-fm-media"
    assert stub_r2["downloads"][0]["key"] == "stage/preprocess/ep-2.wav"


def test_translate_dispatch_emits_empty_output_per_api_schema(
    monkeypatch: pytest.MonkeyPatch,
    webhook_spy: WebhookSpy,
    stub_r2: dict[str, list[Any]],
    tmp_path: Path,
) -> None:
    # The transcript "download" needs to look like valid JSON the handler
    # can read back. Override the r2 stub's downloader to write real JSON.
    def write_real_json(bucket: str, key: str, local: Path) -> None:
        local.parent.mkdir(parents=True, exist_ok=True)
        import json
        local.write_text(
            json.dumps(
                [
                    {
                        "start_ms": 0,
                        "end_ms": 1000,
                        "text": "こんにちは",
                        "confidence": 0.9,
                        "needs_review": False,
                    }
                ]
            )
        )

    monkeypatch.setattr(handler_mod, "download_to_file", write_real_json)

    captured: dict[str, Any] = {}

    def fake_translate(segments, glossary, show_title=None):  # noqa: ANN001
        captured["segments"] = list(segments)
        captured["glossary"] = list(glossary)
        captured["show_title"] = show_title
        return [TranscriptSegment(start_ms=0, end_ms=1000, text="Hello", confidence=0.9)]

    monkeypatch.setattr(handler_mod, "translate_segments", fake_translate)

    handler_mod.handler({
        "input": {
            "stage": "translate",
            "episodeId": "ep-3",
            "eventId": "ep-3:translate:run-1",
            "pipelineRunId": "run-1",
            "webhookUrl": "https://api.example/webhooks/runpod",
            "transcriptUrl": "stage/transcribe/ep-3.json",
            "showTitle": "Test Show",
            "glossary": [
                {"source_text": "こんにちは", "target_text": "Hello", "kind": "term"}
            ],
        }
    })

    assert captured["show_title"] == "Test Show"
    assert len(captured["glossary"]) == 1
    assert captured["glossary"][0].source_text == "こんにちは"

    # Translate.completed carries NO output keys per the api's
    # webhooks-runpod.ts translateCompleted schema (translate's product
    # is in the cues table, not an R2 artifact). Returning {} is the
    # honest representation; pretending we have a usable artifact would
    # invite a downstream caller to depend on something nothing consumes.
    payload = webhook_spy.calls[0]["payload"]
    assert payload["output"] == {}


# ---------------------------------------------------------------------------
# Failure path
# ---------------------------------------------------------------------------


def test_stage_exception_posts_failed_callback_and_reraises(
    monkeypatch: pytest.MonkeyPatch, webhook_spy: WebhookSpy
) -> None:
    def boom(*args: Any, **kw: Any) -> Any:
        raise RuntimeError("preprocess imploded")

    monkeypatch.setattr(handler_mod, "preprocess_for_asr", boom)
    monkeypatch.setattr(handler_mod, "_download_http", _fake_http_download)

    with pytest.raises(RuntimeError, match="preprocess imploded"):
        handler_mod.handler({
            "input": {
                "stage": "preprocess",
                "episodeId": "ep-9",
                "eventId": "ep-9:preprocess:run-1",
                "pipelineRunId": "run-1",
                "webhookUrl": "https://api.example/webhooks/runpod",
                "sourceUrl": "https://example/in.mkv",
            }
        })

    # Re-raise IS the contract (RunPod marks the run failed), but the
    # failure callback must also fire so the api's state machine moves to
    # 'failed' rather than wedging.
    assert len(webhook_spy.calls) == 1
    payload = webhook_spy.calls[0]["payload"]
    assert payload["status"] == "failed"
    assert payload["stage"] == "preprocess"
    assert "preprocess imploded" in payload["error"]
