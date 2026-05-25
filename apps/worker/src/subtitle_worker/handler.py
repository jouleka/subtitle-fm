"""RunPod serverless entrypoint.

One invocation per stage. The TS worker-runner posts to RunPod's `/run`
endpoint with `{input: {episodeId, stage, eventId, pipelineRunId,
webhookUrl, sourceUrl|audioUrl|transcriptUrl}}`. RunPod calls
`handler(event)`; we dispatch to the matching stage module, upload the
output to R2, and POST a signed webhook callback to `webhookUrl` so the
api's `/webhooks/runpod` receiver advances state and enqueues the next
stage.

Cross-stage hand-off URLs may arrive as either:
- `https://...` — fetched via plain HTTP (typical for the first stage,
  where the api hands the user-uploaded R2 GET URL through).
- `<bucket>/<key>` — fetched via R2 using the worker's own credentials.
  This is what the webhook receiver currently passes for downstream
  stages (it threads `output.audioKey` through unchanged).

The handler is the function you'd test; `__main__` boots the runpod SDK.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any

import httpx
import structlog

from subtitle_worker.r2_client import (
    derive_stage_artifact_key,
    download_to_file,
    media_bucket,
    upload_file,
)
from subtitle_worker.stages.asr import TranscriptSegment, transcribe_audio
from subtitle_worker.stages.preprocess import preprocess_for_asr
from subtitle_worker.stages.translate import GlossaryEntry, translate_segments
from subtitle_worker.stages.vocals import isolate_vocals
from subtitle_worker.webhook import post_signed_json

log = structlog.get_logger(__name__)

SUPPORTED_STAGES = {"preprocess", "transcribe", "translate"}


def _resolve_webhook_secret() -> str:
    secret = os.environ.get("WORKER_WEBHOOK_SECRET", "")
    if not secret:
        raise RuntimeError(
            "WORKER_WEBHOOK_SECRET not set — refusing to POST unsigned callbacks"
        )
    return secret


def _fetch_input(url_or_key: str, work_dir: Path, name_hint: str) -> Path:
    """Pull `url_or_key` to a local file inside `work_dir`.

    The api currently passes two URL shapes:
      - HTTPS (first stage's `sourceUrl`, the user-uploaded R2 GET URL)
      - bare R2 key in the media bucket (downstream stages — the webhook
        receiver threads `output.audioKey`/`transcriptKey` unchanged)
    We pick the path purely from the http(s):// prefix; multi-segment keys
    like `stage/preprocess/<id>.wav` stay as full keys in the media bucket.
    """
    if url_or_key.startswith(("http://", "https://")):
        return _download_http(url_or_key, work_dir, name_hint)
    return _download_r2_key(url_or_key, work_dir, name_hint)


def _download_http(url: str, work_dir: Path, name_hint: str) -> Path:
    target = work_dir / f"in_{name_hint}"
    # Partial-file note: if iter_bytes raises mid-stream, `target` is left
    # half-written. The handler's `finally` rmtree(work_dir) cleans it up;
    # we don't try to remove on error here to keep the failure observable.
    with httpx.stream("GET", url, follow_redirects=True, timeout=120.0) as r:
        r.raise_for_status()
        with target.open("wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    return target


def _download_r2_key(key: str, work_dir: Path, name_hint: str) -> Path:
    """Download a bare R2 key from the default media bucket.

    The api never threads a `bucket/key` pair through stage hand-offs —
    it passes the bare key. Keep this dead simple to avoid the previous
    bucket-parsing heuristic that mis-routed `stage/preprocess/<id>.wav`
    to a non-existent `stage` bucket.
    """
    target = work_dir / f"in_{name_hint}"
    download_to_file(media_bucket(), key, target)
    return target


def _write_segments_json(segments: list[TranscriptSegment], path: Path) -> None:
    path.write_text(
        json.dumps([asdict(s) for s in segments], ensure_ascii=False),
        encoding="utf-8",
    )


def _read_segments_json(path: Path) -> list[TranscriptSegment]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [TranscriptSegment(**item) for item in raw]


def _parse_glossary(raw: Any) -> list[GlossaryEntry]:
    if not raw:
        return []
    if not isinstance(raw, list):
        raise ValueError(f"glossary must be a list, got {type(raw).__name__}")
    return [GlossaryEntry(**item) for item in raw]


def _run_preprocess(episode_id: str, source_url: str, work_dir: Path) -> dict[str, str]:
    local = _fetch_input(source_url, work_dir, "source")
    out = preprocess_for_asr(local, work_dir)
    key = derive_stage_artifact_key(episode_id, "preprocess", "wav")
    upload_file(out, media_bucket(), key)
    return {"audioKey": key}


def _run_transcribe(episode_id: str, audio_url: str, work_dir: Path) -> dict[str, str]:
    local = _fetch_input(audio_url, work_dir, "audio.wav")
    vocals = isolate_vocals(local, work_dir)
    segments = transcribe_audio(vocals.vocals_path)
    out_path = work_dir / "transcript.json"
    _write_segments_json(segments, out_path)
    key = derive_stage_artifact_key(episode_id, "transcribe", "json")
    upload_file(out_path, media_bucket(), key)
    return {"transcriptKey": key}


def _run_translate(
    episode_id: str,
    transcript_url: str,
    glossary_raw: Any,
    show_title: str | None,
    work_dir: Path,
) -> dict[str, str]:
    """Translate stage.

    Per the api's webhook schema (`translateCompleted` in webhooks-runpod.ts),
    translate.completed carries NO output keys — the next stage is
    `ready_for_edit`, which is human-driven in the editor, not file-driven.
    The translated segments should land in the `cues` table; that wiring is
    a future slice (the api receiver doesn't accept a key here today).
    Returning {} now and skipping a useless R2 upload is more honest than
    pretending we have a usable artifact (Rule 12).

    TODO: once the cues writer exists, this stage should POST the segments
    to a /episodes/:id/cues endpoint or write directly to the DB from here.
    """
    local = _fetch_input(transcript_url, work_dir, "transcript.json")
    segments = _read_segments_json(local)
    glossary = _parse_glossary(glossary_raw)
    translated = translate_segments(segments, glossary, show_title=show_title)
    # Keep the file in work_dir for log inspection on RunPod; don't upload.
    out_path = work_dir / "translated.json"
    _write_segments_json(translated, out_path)
    # episode_id is unused right now but kept in the signature for symmetry
    # with the other stages and for the cues-writer follow-up.
    del episode_id
    return {}


def handler(event: dict[str, Any]) -> dict[str, Any]:
    """RunPod serverless handler. Returns RunPod's response body."""
    inp = event.get("input") or {}
    stage = inp.get("stage")
    episode_id = inp.get("episodeId")
    event_id = inp.get("eventId")
    pipeline_run_id = inp.get("pipelineRunId")
    webhook_url = inp.get("webhookUrl")

    # Cheap validation before doing any work — failing here is cheaper than
    # a half-completed stage with no usable webhook target. These are
    # dispatcher-routing errors, not episode failures, so we raise before
    # the failure-callback block can run.
    missing = [
        k
        for k, v in {
            "stage": stage,
            "episodeId": episode_id,
            "eventId": event_id,
            "pipelineRunId": pipeline_run_id,
            "webhookUrl": webhook_url,
        }.items()
        if not v
    ]
    if missing:
        # No webhook callback here — without webhookUrl we have nowhere to
        # send it, and a wrong-stage callback would mis-fail the episode
        # for a dispatcher routing bug.
        raise ValueError(f"missing required input keys: {missing}")
    if stage not in SUPPORTED_STAGES:
        # Same — don't fail the episode for a dispatcher routing bug. The
        # caller (worker-runner) should never send unsupported stages here.
        raise ValueError(
            f"unsupported stage {stage!r}; supported: {sorted(SUPPORTED_STAGES)}"
        )

    secret = _resolve_webhook_secret()
    log.info("handler.start", stage=stage, episode_id=episode_id, event_id=event_id)

    work_dir = Path(tempfile.mkdtemp(prefix=f"sfm-{stage}-"))
    try:
        try:
            if stage == "preprocess":
                output = _run_preprocess(episode_id, inp["sourceUrl"], work_dir)
            elif stage == "transcribe":
                output = _run_transcribe(episode_id, inp["audioUrl"], work_dir)
            else:  # translate
                output = _run_translate(
                    episode_id,
                    inp["transcriptUrl"],
                    inp.get("glossary"),
                    inp.get("showTitle"),
                    work_dir,
                )
        except Exception as stage_err:
            # Stage executed (or tried to). Post the failure callback so
            # the api's state machine advances to 'failed' rather than
            # wedging. Then re-raise so RunPod marks the run FAILED in its
            # dashboard. Pre-flight validation errors above this block do
            # NOT trigger this — those are dispatcher bugs, not episode
            # failures.
            log.error(
                "handler.stage_error",
                stage=stage,
                episode_id=episode_id,
                error=str(stage_err),
            )
            try:
                post_signed_json(
                    webhook_url,
                    {
                        "eventId": event_id,
                        "episodeId": episode_id,
                        "pipelineRunId": pipeline_run_id,
                        "stage": stage,
                        "status": "failed",
                        "error": str(stage_err),
                    },
                    secret=secret,
                )
            except Exception as cb_err:
                log.error("handler.failure_callback_failed", error=str(cb_err))
            raise

        post_signed_json(
            webhook_url,
            {
                "eventId": event_id,
                "episodeId": episode_id,
                "pipelineRunId": pipeline_run_id,
                "stage": stage,
                "status": "completed",
                "output": output,
            },
            secret=secret,
        )
        log.info("handler.done", stage=stage, episode_id=episode_id)
        return {"status": "completed", "stage": stage, "output": output}

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    import runpod  # type: ignore[import-untyped]

    runpod.serverless.start({"handler": handler})
