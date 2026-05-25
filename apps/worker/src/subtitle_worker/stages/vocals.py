"""Demucs vocal isolation stage.

Takes the preprocessed audio from `stages/preprocess.py` and emits a
vocals-only WAV. Anime has nearly constant BGM; running ASR on the raw
mix is the #1 cause of word drops and repetition-loop hallucinations
(see SFM-A-1 design doc). Vocal isolation shaves ~30s on RTX 4090 and
reliably improves WER on Japanese anime audio.

Model: `htdemucs` — Demucs v4's hybrid transformer model. Smaller than
`htdemucs_ft`, fast enough for per-episode use, good enough for music
suppression. Switch to `htdemucs_ft` later if quality demands it.

This module is dependency-deferred: we lazy-import `demucs.api` inside
the function so the worker package can be partially used (e.g. local
preprocess-only dev) without paying torch's import cost.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import structlog

DEFAULT_MODEL = "htdemucs"
# Pass-through: when None, demucs.api.Separator picks
#   "cuda" if torch.cuda.is_available() else "cpu"
# at its own constructor. Setting "cuda" explicitly here would skip that
# check and hard-fail on a CPU-only box.
DEFAULT_DEVICE: str | None = None
DEFAULT_SHIFTS = 1  # >1 = test-time augmentation (slower, marginal quality gain)

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class VocalsOutput:
    """The artifact emitted by the vocals stage."""

    vocals_path: Path
    """PCM16 mono WAV containing the isolated vocals track."""

    model: str
    """Demucs model used (recorded for reproducibility)."""


class DemucsNotAvailable(RuntimeError):
    """Raised when the demucs library cannot be imported (no torch, no install)."""


def check_demucs_available() -> None:
    """Fail loud if demucs isn't installed.

    Importing demucs pulls in torch (~2GB on disk). Local dev that doesn't
    need vocal isolation can skip the install and run the preprocess
    stage on its own.
    """
    try:
        import demucs.api  # noqa: F401
    except ImportError as e:
        raise DemucsNotAvailable(
            "demucs not importable. Install with `pip install demucs` "
            "(pulls in torch). On RunPod images the demucs+torch stack is "
            "pre-baked into the container."
        ) from e


def derive_vocals_path(work_dir: Path) -> Path:
    """Pure helper: stable filename for the vocals artifact inside `work_dir`.

    Downstream stages (ASR) compute this from the same `work_dir` so the
    path never has to be plumbed through the call chain.
    """
    return work_dir / "vocals.wav"


def isolate_vocals(
    input_path: Path,
    work_dir: Path,
    model: str = DEFAULT_MODEL,
    device: str | None = DEFAULT_DEVICE,
    shifts: int = DEFAULT_SHIFTS,
) -> VocalsOutput:
    """Run Demucs to extract the vocals stem from `input_path`.

    Emits a single-channel WAV (downmixed from Demucs' stereo output to
    match the rest of the pipeline's mono contract).
    """
    check_demucs_available()
    work_dir.mkdir(parents=True, exist_ok=True)
    output_path = derive_vocals_path(work_dir)

    # Lazy import — keeps the test/dev surface importable without torch.
    from demucs.api import Separator, save_audio

    log.info(
        "vocals.isolate.start",
        input=str(input_path),
        output=str(output_path),
        model=model,
        device=device or "auto",
        shifts=shifts,
    )
    start = time.monotonic()

    # When `device` is None, omit it from the call so Separator uses its
    # own `"cuda" if available else "cpu"` default. Passing device=None
    # explicitly also works in current versions, but staying defensive.
    separator_kwargs: dict[str, object] = {"model": model, "shifts": shifts}
    if device is not None:
        separator_kwargs["device"] = device
    separator = Separator(**separator_kwargs)

    _, sources = separator.separate_audio_file(str(input_path))

    if "vocals" not in sources:
        raise RuntimeError(
            f"demucs returned no 'vocals' stem; got: {sorted(sources.keys())}"
        )

    vocals_tensor = sources["vocals"]
    # Demucs always emits stereo; downmix to mono so the file matches the
    # 16kHz/mono contract from preprocess. Mean across channel dim 0.
    if vocals_tensor.ndim == 2 and vocals_tensor.shape[0] > 1:
        vocals_tensor = vocals_tensor.mean(dim=0, keepdim=True)

    save_audio(vocals_tensor, str(output_path), samplerate=separator.samplerate)

    elapsed = time.monotonic() - start
    log.info(
        "vocals.isolate.done",
        output=str(output_path),
        model=model,
        elapsed_sec=round(elapsed, 2),
    )
    return VocalsOutput(vocals_path=output_path, model=model)
