"""Tests for audiowaveform command construction and failures."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from subtitle_worker.stages import peaks


def test_generate_waveform_data_runs_expected_command(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    input_path = tmp_path / "audio.wav"
    output_path = tmp_path / "nested" / "waveform.dat"
    input_path.write_bytes(b"audio")
    seen: list[list[str]] = []

    monkeypatch.setattr(peaks.shutil, "which", lambda _name: "/usr/bin/audiowaveform")

    def fake_run(command: list[str], **_kwargs: object) -> None:
        seen.append(command)
        output_path.write_bytes(b"waveform")

    monkeypatch.setattr(peaks.subprocess, "run", fake_run)

    assert peaks.generate_waveform_data(input_path, output_path) == output_path
    assert seen == [
        [
            "audiowaveform",
            "--input-filename",
            str(input_path),
            "--output-filename",
            str(output_path),
            "--output-format",
            "dat",
            "--pixels-per-second",
            "256",
            "--bits",
            "8",
            "--quiet",
        ]
    ]


def test_generate_waveform_data_requires_executable(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(peaks.shutil, "which", lambda _name: None)
    with pytest.raises(peaks.AudiowaveformNotAvailableError, match="PATH"):
        peaks.generate_waveform_data(tmp_path / "audio.wav", tmp_path / "out.dat")


def test_generate_waveform_data_surfaces_process_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(peaks.shutil, "which", lambda _name: "/usr/bin/audiowaveform")

    def fail(command: list[str], **_kwargs: object) -> None:
        raise subprocess.CalledProcessError(1, command, stderr="bad audio")

    monkeypatch.setattr(peaks.subprocess, "run", fail)
    with pytest.raises(RuntimeError, match="bad audio"):
        peaks.generate_waveform_data(tmp_path / "audio.wav", tmp_path / "out.dat")


@pytest.mark.parametrize("pixels,bits", [(0, 8), (256, 4)])
def test_generate_waveform_data_validates_options(tmp_path: Path, pixels: int, bits: int) -> None:
    with pytest.raises(ValueError):
        peaks.generate_waveform_data(
            tmp_path / "audio.wav",
            tmp_path / "out.dat",
            pixels_per_second=pixels,
            bits=bits,
        )
