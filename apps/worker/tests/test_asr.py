"""Tests for the ASR stage.

Pure helpers (logprob_to_confidence, TranscriptSegment, ImportError path)
run unconditionally. Real transcription is gated on faster-whisper +
model files being available.
"""

from __future__ import annotations

import math
import sys
from dataclasses import FrozenInstanceError

import pytest

from subtitle_worker.stages.asr import (
    DEFAULT_LANGUAGE,
    DEFAULT_MODEL_PATH,
    FasterWhisperNotAvailable,
    TranscriptSegment,
    check_faster_whisper_available,
    logprob_to_confidence,
)


# ---------------------------------------------------------------------------
# logprob_to_confidence
# ---------------------------------------------------------------------------


class TestLogprobToConfidence:
    def test_logprob_zero_maps_to_full_confidence(self) -> None:
        # log(1) = 0 → exp(0) = 1.0 (model was perfectly confident)
        assert logprob_to_confidence(0.0) == 1.0

    def test_logprob_negative_one_is_about_0_37(self) -> None:
        # Whisper's own "low confidence" threshold ≈ avg_logprob < -1.0
        assert logprob_to_confidence(-1.0) == pytest.approx(math.exp(-1.0))

    def test_logprob_very_negative_approaches_zero(self) -> None:
        result = logprob_to_confidence(-10.0)
        assert result > 0.0
        assert result < 0.001

    def test_monotonicity_higher_logprob_higher_confidence(self) -> None:
        # Intent: a regression that inverted the mapping must fail this.
        assert logprob_to_confidence(-0.1) > logprob_to_confidence(-0.5)
        assert logprob_to_confidence(-0.5) > logprob_to_confidence(-2.0)

    def test_returns_native_float_not_numpy(self) -> None:
        # Whisper returns np.float32; Postgres / JSON serialization needs
        # native float. This pins the conversion.
        result = logprob_to_confidence(-0.5)
        assert type(result) is float


# ---------------------------------------------------------------------------
# TranscriptSegment
# ---------------------------------------------------------------------------


class TestTranscriptSegment:
    def test_carries_all_fields(self) -> None:
        seg = TranscriptSegment(
            start_ms=1000,
            end_ms=3500,
            text="こんにちは",
            confidence=0.92,
        )
        assert seg.start_ms == 1000
        assert seg.end_ms == 3500
        assert seg.text == "こんにちは"
        assert seg.confidence == 0.92

    def test_is_frozen(self) -> None:
        # Frozen so a confused caller can't mutate a segment after the fact
        # (e.g. the translation stage shouldn't be patching ASR results in place).
        seg = TranscriptSegment(start_ms=0, end_ms=1, text="", confidence=1.0)
        with pytest.raises(FrozenInstanceError):
            seg.text = "mutated"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# check_faster_whisper_available
# ---------------------------------------------------------------------------


def test_check_faster_whisper_available_raises_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Force ImportError even if faster-whisper IS installed.
    # monkeypatch.setitem restores sys.modules on teardown.
    monkeypatch.setitem(sys.modules, "faster_whisper", None)
    with pytest.raises(FasterWhisperNotAvailable) as exc_info:
        check_faster_whisper_available()
    # Error must mention how to install (Rule 12: fail loud, actionable).
    assert "faster-whisper" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Defaults pinning
# ---------------------------------------------------------------------------


def test_defaults_match_sfm_design_doc() -> None:
    # The model + language choices are load-bearing decisions per SFM-A-1
    # and the SFM-14 issue. Pin them so a silent change in DEFAULT_MODEL_PATH
    # is visible in PR diffs and reviewable, not absorbed into a one-line edit.
    assert DEFAULT_MODEL_PATH == "litagin/anime-whisper"
    assert DEFAULT_LANGUAGE == "ja"
