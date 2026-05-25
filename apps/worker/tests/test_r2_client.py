"""Tests for the R2 client + key helpers.

Real boto3 calls aren't exercised — they need network + creds. We test the
pure helpers (key shape, validation) and the env-resolution failure mode.
"""

from __future__ import annotations

import pytest

from subtitle_worker.r2_client import (
    DEFAULT_BUCKET_MEDIA,
    DEFAULT_BUCKET_PEAKS,
    R2NotConfigured,
    _resolve_creds,
    derive_stage_artifact_key,
    media_bucket,
    peaks_bucket,
)


class TestDeriveStageArtifactKey:
    def test_basic_shape(self) -> None:
        key = derive_stage_artifact_key("ep-uuid", "preprocess", "wav")
        assert key == "stage/preprocess/ep-uuid.wav"

    def test_stable_across_calls(self) -> None:
        # Rule 12 intent: stable per (episode, stage) so a retry overwrites
        # rather than leaks. A non-deterministic key here = silent garbage.
        a = derive_stage_artifact_key("ep-x", "transcribe", "json")
        b = derive_stage_artifact_key("ep-x", "transcribe", "json")
        assert a == b

    def test_differs_per_stage(self) -> None:
        assert derive_stage_artifact_key("ep-x", "preprocess", "wav") != \
            derive_stage_artifact_key("ep-x", "transcribe", "wav")

    def test_differs_per_episode(self) -> None:
        assert derive_stage_artifact_key("ep-1", "preprocess", "wav") != \
            derive_stage_artifact_key("ep-2", "preprocess", "wav")

    def test_rejects_path_traversal_in_episode_id(self) -> None:
        with pytest.raises(ValueError):
            derive_stage_artifact_key("../escape", "preprocess", "wav")
        with pytest.raises(ValueError):
            derive_stage_artifact_key("a/b", "preprocess", "wav")

    def test_rejects_slash_in_stage(self) -> None:
        with pytest.raises(ValueError):
            derive_stage_artifact_key("ep-1", "preprocess/bad", "wav")

    def test_rejects_dot_in_ext(self) -> None:
        # ext is appended after a literal '.' — embedding another dot would
        # change the file extension semantics.
        with pytest.raises(ValueError):
            derive_stage_artifact_key("ep-1", "preprocess", "wav.mp4")

    def test_rejects_empty_inputs(self) -> None:
        with pytest.raises(ValueError):
            derive_stage_artifact_key("", "preprocess", "wav")
        with pytest.raises(ValueError):
            derive_stage_artifact_key("ep-1", "", "wav")
        with pytest.raises(ValueError):
            derive_stage_artifact_key("ep-1", "preprocess", "")


class TestBucketResolution:
    def test_media_bucket_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("R2_BUCKET_MEDIA", raising=False)
        assert media_bucket() == DEFAULT_BUCKET_MEDIA

    def test_media_bucket_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("R2_BUCKET_MEDIA", "custom-media")
        assert media_bucket() == "custom-media"

    def test_peaks_bucket_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("R2_BUCKET_PEAKS", raising=False)
        assert peaks_bucket() == DEFAULT_BUCKET_PEAKS


class TestResolveCreds:
    def test_raises_when_account_id_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("R2_ACCOUNT_ID", raising=False)
        monkeypatch.setenv("R2_ACCESS_KEY_ID", "x")
        monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "y")
        with pytest.raises(R2NotConfigured, match="R2_ACCOUNT_ID"):
            _resolve_creds()

    def test_raises_when_key_missing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("R2_ACCOUNT_ID", "acct")
        monkeypatch.delenv("R2_ACCESS_KEY_ID", raising=False)
        monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "y")
        with pytest.raises(R2NotConfigured):
            _resolve_creds()

    def test_returns_tuple_when_all_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("R2_ACCOUNT_ID", "acct")
        monkeypatch.setenv("R2_ACCESS_KEY_ID", "k")
        monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "s")
        assert _resolve_creds() == ("acct", "k", "s")
