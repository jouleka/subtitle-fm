"""Shared pytest fixtures.

Generates short synthetic audio/video clips via ffmpeg's lavfi so tests
don't need any committed media fixtures.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

# All preprocess tests need ffmpeg on PATH. Skip cleanly when it's missing
# so a partial dev environment doesn't fail noisy.
requires_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None,
    reason="ffmpeg binary not on PATH",
)


def _run_ffmpeg(args: list[str]) -> None:
    subprocess.run(args, check=True, capture_output=True)


@pytest.fixture
def sample_mp3(tmp_path: Path) -> Path:
    """10s 44.1kHz stereo sine wave encoded as MP3.

    Stereo + non-target-rate forces extract_audio_to_wav to actually
    transcode rather than passthrough.
    """
    output = tmp_path / "input.mp3"
    _run_ffmpeg(
        [
            "ffmpeg",
            "-f", "lavfi",
            "-i", "sine=frequency=440:duration=10",
            "-ar", "44100",
            "-ac", "2",
            "-y", str(output),
        ]
    )
    return output


@pytest.fixture
def sample_wav(tmp_path: Path) -> Path:
    """10s 16kHz mono WAV — already in target shape, useful for trim-only tests."""
    output = tmp_path / "input.wav"
    _run_ffmpeg(
        [
            "ffmpeg",
            "-f", "lavfi",
            "-i", "sine=frequency=440:duration=10",
            "-ar", "16000",
            "-ac", "1",
            "-y", str(output),
        ]
    )
    return output




