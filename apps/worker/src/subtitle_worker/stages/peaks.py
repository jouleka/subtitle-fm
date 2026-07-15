"""Generate Peaks.js-compatible binary waveform data with audiowaveform."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

DEFAULT_PIXELS_PER_SECOND = 256
DEFAULT_BITS = 8


class AudiowaveformNotAvailableError(RuntimeError):
    """Raised when the audiowaveform executable is not installed."""


def generate_waveform_data(
    input_path: Path,
    output_path: Path,
    *,
    pixels_per_second: int = DEFAULT_PIXELS_PER_SECOND,
    bits: int = DEFAULT_BITS,
    executable: str = "audiowaveform",
) -> Path:
    """Generate an idempotently replaceable binary ``.dat`` waveform."""
    if pixels_per_second <= 0:
        raise ValueError("pixels_per_second must be positive")
    if bits not in {8, 16}:
        raise ValueError("bits must be 8 or 16")
    if shutil.which(executable) is None:
        raise AudiowaveformNotAvailableError(
            f"{executable} is not installed or is not available on PATH"
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        executable,
        "--input-filename",
        str(input_path),
        "--output-filename",
        str(output_path),
        "--output-format",
        "dat",
        "--pixels-per-second",
        str(pixels_per_second),
        "--bits",
        str(bits),
        "--quiet",
    ]
    try:
        subprocess.run(command, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or exc.stdout.strip() or "unknown error"
        raise RuntimeError(f"audiowaveform failed: {detail}") from exc

    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise RuntimeError("audiowaveform completed without producing waveform data")
    return output_path
