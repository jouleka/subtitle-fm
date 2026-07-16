"""Preprocess stage: source media → 16kHz mono WAV with OP/ED trimmed.

Hand-off contract: emits a single WAV file ready for the Demucs vocal
isolation stage (SFM-13). Anything more sophisticated (per-show OP/ED
override timestamps, music-only mid-episode trimming) is deferred to
subsequent slices; this stage uses fixed-window defaults that work for
most 23–24 minute anime episodes.

Why fixed-window over PySceneDetect-first detection:
PySceneDetect finds video cuts, which only loosely correlate with OP/ED
boundaries (animated sequences have heavy cutting *within* the OP, not
necessarily at its start/end). Fixed windows are more reliable for the
typical TV anime case.

Audio-stream selection:
We explicitly map `0:a:0` (first audio stream). Anime sources frequently
ship multiple audio tracks (JP, EN dub, commentary); the bare `.audio`
helper would map all of them and either fail or silently feed the wrong
track to ASR. The pipeline assumes the source language track is at
position 0 — document this in the upload UI so users mux accordingly.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path

import ffmpeg

# Defaults sized to typical TV anime (23–24 min episodes).
DEFAULT_LEADING_TRIM_SEC = 120.0  # OP-typical; covers cold open + 90s OP
DEFAULT_TRAILING_TRIM_SEC = 90.0  # ED-typical
DEFAULT_SAMPLE_RATE_HZ = 16_000  # what faster-whisper expects on input
SHORT_CLIP_MARGIN_SEC = 30.0  # below this clear margin we use the edge-shave fallback


@dataclass(frozen=True)
class TrimBounds:
    """Audio trim bounds in seconds from the start of the file."""

    start_sec: float
    end_sec: float

    def duration_sec(self) -> float:
        return self.end_sec - self.start_sec


class FfmpegNotAvailable(RuntimeError):
    """Raised when the ffmpeg binary is not on PATH."""


def check_ffmpeg_available() -> None:
    """Fail loud (Rule 12) if ffmpeg isn't installed — every stage needs it."""
    if shutil.which("ffmpeg") is None:
        raise FfmpegNotAvailable(
            "ffmpeg binary not found on PATH. Install via your package manager "
            "(`brew install ffmpeg`, `apt install ffmpeg`, etc.) or ensure the "
            "RunPod image bundles it."
        )


def probe_duration_sec(input_path: Path) -> float:
    """Return media duration in seconds via ffprobe."""
    check_ffmpeg_available()
    info = ffmpeg.probe(str(input_path))
    duration = info.get("format", {}).get("duration")
    if duration is None:
        raise RuntimeError(f"ffprobe could not determine duration of {input_path}")
    return float(duration)


def extract_audio_to_wav(
    input_path: Path,
    output_path: Path,
    sample_rate_hz: int = DEFAULT_SAMPLE_RATE_HZ,
) -> None:
    """Extract the first audio track to mono PCM16 WAV at the given sample rate.

    Explicitly selects stream `0:a:0` — see module docstring for why.
    """
    check_ffmpeg_available()
    try:
        audio = ffmpeg.input(str(input_path))["a:0"]
        (
            audio.output(
                str(output_path),
                acodec="pcm_s16le",
                ar=sample_rate_hz,
                ac=1,
            )
            .overwrite_output()
            .run(quiet=True, capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg.Error as e:
        stderr = e.stderr.decode("utf-8", errors="replace") if e.stderr else ""
        raise RuntimeError(f"ffmpeg extract failed: {stderr}") from e


def trim_audio(input_path: Path, output_path: Path, bounds: TrimBounds) -> None:
    """Trim audio to the given bounds, re-encoding as PCM16 WAV (lossless).

    Uses `-ss <start>` on the input (fast seek) and `-t <duration>` on the
    output (unambiguous duration). Avoids `-to` because its absolute-vs-
    relative semantics changed across ffmpeg releases.
    """
    check_ffmpeg_available()
    if bounds.duration_sec() <= 0:
        raise ValueError(f"trim bounds produce zero-or-negative duration: {bounds}")
    try:
        audio = ffmpeg.input(str(input_path), ss=bounds.start_sec)["a:0"]
        (
            audio.output(
                str(output_path),
                acodec="pcm_s16le",
                t=bounds.duration_sec(),
            )
            .overwrite_output()
            .run(quiet=True, capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg.Error as e:
        stderr = e.stderr.decode("utf-8", errors="replace") if e.stderr else ""
        raise RuntimeError(f"ffmpeg trim failed: {stderr}") from e


def compute_default_trim_bounds(
    total_duration_sec: float,
    leading_trim_sec: float = DEFAULT_LEADING_TRIM_SEC,
    trailing_trim_sec: float = DEFAULT_TRAILING_TRIM_SEC,
) -> TrimBounds:
    """Pick trim bounds, clamping so a short clip never produces an empty window.

    Short-clip behaviour (no usable OP/ED to trim): shave 5s from each end
    or 25% whichever is smaller, so the result is non-empty.
    """
    if total_duration_sec <= 0:
        raise ValueError(f"total_duration_sec must be > 0, got {total_duration_sec}")

    # Require at least 30 seconds for normal episode-length media, but scale
    # that guard down for short clips. Otherwise an explicit 2s + 2s trim on a
    # 10s clip is unexpectedly replaced by the fallback even though 60% of the
    # requested clip remains.
    minimum_remaining_sec = min(SHORT_CLIP_MARGIN_SEC, total_duration_sec / 2)
    if total_duration_sec <= leading_trim_sec + trailing_trim_sec + minimum_remaining_sec:
        edge = min(5.0, total_duration_sec / 4)
        return TrimBounds(start_sec=edge, end_sec=total_duration_sec - edge)

    return TrimBounds(
        start_sec=leading_trim_sec,
        end_sec=total_duration_sec - trailing_trim_sec,
    )


def preprocess_for_asr(
    source_path: Path,
    work_dir: Path,
    leading_trim_sec: float = DEFAULT_LEADING_TRIM_SEC,
    trailing_trim_sec: float = DEFAULT_TRAILING_TRIM_SEC,
    sample_rate_hz: int = DEFAULT_SAMPLE_RATE_HZ,
) -> Path:
    """End-to-end preprocess: extract + trim. Returns the trimmed WAV path.

    Steps:
      1. Extract first audio track to PCM16 mono WAV at sample_rate_hz.
      2. Probe duration.
      3. Compute trim bounds (fixed-window OP/ED skip, short-clip safe).
      4. Trim to those bounds.
    """
    work_dir.mkdir(parents=True, exist_ok=True)
    extracted_path = work_dir / "extracted.wav"
    trimmed_path = work_dir / "trimmed.wav"

    extract_audio_to_wav(source_path, extracted_path, sample_rate_hz=sample_rate_hz)
    duration_sec = probe_duration_sec(extracted_path)
    bounds = compute_default_trim_bounds(
        total_duration_sec=duration_sec,
        leading_trim_sec=leading_trim_sec,
        trailing_trim_sec=trailing_trim_sec,
    )
    trim_audio(extracted_path, trimmed_path, bounds)
    return trimmed_path
