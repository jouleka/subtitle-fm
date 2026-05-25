"""Tests for the preprocess stage.

Every ffmpeg-touching test is gated by `requires_ffmpeg`. The pure-logic
tests (compute_default_trim_bounds, check_ffmpeg_available) run
unconditionally.
"""

from __future__ import annotations

import wave
from pathlib import Path

import pytest

from subtitle_worker.stages.preprocess import (
    DEFAULT_SAMPLE_RATE_HZ,
    FfmpegNotAvailable,
    TrimBounds,
    check_ffmpeg_available,
    compute_default_trim_bounds,
    extract_audio_to_wav,
    preprocess_for_asr,
    probe_duration_sec,
    trim_audio,
)

from .conftest import requires_ffmpeg


# ---------------------------------------------------------------------------
# Pure logic (no ffmpeg needed)
# ---------------------------------------------------------------------------


class TestComputeDefaultTrimBounds:
    def test_full_episode_uses_defaults(self) -> None:
        # 24-min episode (1440s) → 120s lead + 90s trail = 1230s middle (20:30)
        bounds = compute_default_trim_bounds(total_duration_sec=24 * 60)
        assert bounds.start_sec == 120
        assert bounds.end_sec == 24 * 60 - 90
        assert bounds.duration_sec() == pytest.approx(20 * 60 + 30)

    def test_short_clip_falls_back_to_minimal_edge_trim(self) -> None:
        # 60s clip: full defaults (120 + 90) would produce a negative window.
        # Expect non-empty bounds via the short-clip path.
        bounds = compute_default_trim_bounds(total_duration_sec=60)
        assert bounds.start_sec >= 0
        assert bounds.end_sec <= 60
        assert bounds.duration_sec() > 0

    def test_custom_trim_values_override_defaults(self) -> None:
        bounds = compute_default_trim_bounds(
            total_duration_sec=24 * 60,
            leading_trim_sec=100,
            trailing_trim_sec=60,
        )
        assert bounds.start_sec == 100
        assert bounds.end_sec == 24 * 60 - 60

    def test_zero_duration_raises(self) -> None:
        # Intent: a 0-second source is a hard error, not a silent no-op.
        with pytest.raises(ValueError):
            compute_default_trim_bounds(total_duration_sec=0)

    def test_negative_duration_raises(self) -> None:
        with pytest.raises(ValueError):
            compute_default_trim_bounds(total_duration_sec=-10)

    def test_boundary_at_30s_margin_uses_short_clip_path(self) -> None:
        # 240s = 120 lead + 90 trail + 30 margin exactly. Boundary <= => short-clip.
        # Pins which branch is taken so a `<` ↔ `<=` flip doesn't silently pass.
        bounds = compute_default_trim_bounds(total_duration_sec=240)
        assert bounds.start_sec == 5  # min(5, 240/4) = 5
        assert bounds.end_sec == 235

    def test_just_above_short_clip_threshold_uses_default_trim(self) -> None:
        # 241s: one second above the boundary, falls into the default-trim path.
        # Pins the OTHER branch of the boundary check.
        bounds = compute_default_trim_bounds(total_duration_sec=241)
        assert bounds.start_sec == 120
        assert bounds.end_sec == 241 - 90


# ---------------------------------------------------------------------------
# check_ffmpeg_available
# ---------------------------------------------------------------------------


def test_check_ffmpeg_available_raises_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("subtitle_worker.stages.preprocess.shutil.which", lambda _: None)
    with pytest.raises(FfmpegNotAvailable):
        check_ffmpeg_available()


def test_check_ffmpeg_available_passes_when_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "subtitle_worker.stages.preprocess.shutil.which",
        lambda _: "/usr/local/bin/ffmpeg",
    )
    # Should not raise
    check_ffmpeg_available()


# ---------------------------------------------------------------------------
# Integration tests (require ffmpeg)
# ---------------------------------------------------------------------------


@requires_ffmpeg
def test_extract_audio_produces_16khz_mono_pcm16_wav(
    sample_mp3: Path, tmp_path: Path
) -> None:
    output = tmp_path / "out.wav"
    extract_audio_to_wav(sample_mp3, output)

    assert output.exists()
    with wave.open(str(output), "rb") as wav:
        assert wav.getframerate() == DEFAULT_SAMPLE_RATE_HZ
        assert wav.getnchannels() == 1
        assert wav.getsampwidth() == 2  # 16-bit


@requires_ffmpeg
def test_extract_respects_custom_sample_rate(sample_mp3: Path, tmp_path: Path) -> None:
    output = tmp_path / "out.wav"
    extract_audio_to_wav(sample_mp3, output, sample_rate_hz=22_050)

    with wave.open(str(output), "rb") as wav:
        assert wav.getframerate() == 22_050


@requires_ffmpeg
def test_probe_duration_matches_generated(sample_mp3: Path) -> None:
    # MP3 encoder may add a tiny bit of priming; allow ±0.5s.
    duration = probe_duration_sec(sample_mp3)
    assert 9.5 < duration < 10.5


@requires_ffmpeg
def test_trim_audio_respects_bounds(sample_wav: Path, tmp_path: Path) -> None:
    trimmed = tmp_path / "trimmed.wav"
    trim_audio(sample_wav, trimmed, TrimBounds(start_sec=2.0, end_sec=7.0))

    duration = probe_duration_sec(trimmed)
    assert 4.5 < duration < 5.5


@requires_ffmpeg
def test_trim_audio_rejects_zero_window(sample_wav: Path, tmp_path: Path) -> None:
    trimmed = tmp_path / "trimmed.wav"
    with pytest.raises(ValueError):
        trim_audio(sample_wav, trimmed, TrimBounds(start_sec=5.0, end_sec=5.0))


@requires_ffmpeg
def test_preprocess_for_asr_end_to_end(sample_mp3: Path, tmp_path: Path) -> None:
    # 10s input - 2s lead - 2s trail = 6s output
    output = preprocess_for_asr(
        source_path=sample_mp3,
        work_dir=tmp_path / "work",
        leading_trim_sec=2,
        trailing_trim_sec=2,
    )

    assert output.exists()
    with wave.open(str(output), "rb") as wav:
        assert wav.getframerate() == DEFAULT_SAMPLE_RATE_HZ
        assert wav.getnchannels() == 1
    duration = probe_duration_sec(output)
    assert 5.5 < duration < 6.5


@requires_ffmpeg
def test_preprocess_creates_work_dir(sample_mp3: Path, tmp_path: Path) -> None:
    work_dir = tmp_path / "fresh" / "nested"
    assert not work_dir.exists()
    preprocess_for_asr(
        source_path=sample_mp3,
        work_dir=work_dir,
        leading_trim_sec=2,
        trailing_trim_sec=2,
    )
    assert work_dir.exists()
