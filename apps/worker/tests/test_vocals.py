"""Tests for the vocal isolation stage.

Demucs + torch are heavy; the real-separation test is gated by
`importorskip` on `demucs`. Pure helpers (path derivation, dataclass
shape, ImportError path) run unconditionally.
"""

from __future__ import annotations

import sys
import wave
from pathlib import Path

import pytest

from subtitle_worker.stages.vocals import (
    DEFAULT_MODEL,
    DemucsNotAvailable,
    VocalsOutput,
    check_demucs_available,
    derive_vocals_path,
)

from .conftest import requires_ffmpeg

# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_derive_vocals_path_lives_under_work_dir(tmp_path: Path) -> None:
    work_dir = tmp_path / "work"
    path = derive_vocals_path(work_dir)
    assert path.parent == work_dir
    assert path.name == "vocals.wav"


def test_vocals_output_carries_model_for_reproducibility(tmp_path: Path) -> None:
    # The model field is downstream-visible (logged on every run) so a
    # quality regression caused by a model switch is auditable.
    out = VocalsOutput(vocals_path=tmp_path / "vocals.wav", model="htdemucs")
    assert out.model == "htdemucs"


# ---------------------------------------------------------------------------
# check_demucs_available
# ---------------------------------------------------------------------------


def test_check_demucs_available_raises_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Force the import to fail so we exercise the error path even when
    # demucs IS installed in the dev environment. monkeypatch.setitem
    # restores sys.modules on test teardown.
    monkeypatch.setitem(sys.modules, "demucs.api", None)
    monkeypatch.setitem(sys.modules, "demucs", None)
    with pytest.raises(DemucsNotAvailable) as exc_info:
        check_demucs_available()
    # Error message must mention how to install — Rule 12 (fail loud,
    # actionable).
    assert "demucs" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Real Demucs separation (heavy, gated on demucs being installed)
# ---------------------------------------------------------------------------


@requires_ffmpeg
def test_isolate_vocals_emits_mono_wav_at_demucs_samplerate(
    sample_wav: Path, tmp_path: Path
) -> None:
    pytest.importorskip("demucs")
    pytest.importorskip("torch")
    # Lazy import inside the test so the file imports even without demucs.
    from subtitle_worker.stages.vocals import isolate_vocals

    result = isolate_vocals(sample_wav, tmp_path / "work", device="cpu", shifts=1)
    assert result.vocals_path.exists()
    assert result.model == DEFAULT_MODEL
    with wave.open(str(result.vocals_path), "rb") as wav:
        # Mono per our downmix contract.
        assert wav.getnchannels() == 1
        # Demucs runs at its own samplerate (44.1k typically); we don't
        # downsample here — downstream resampling happens at the ASR stage.
        assert wav.getframerate() > 0
