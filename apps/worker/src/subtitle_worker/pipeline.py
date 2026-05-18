"""Pipeline stages: preprocess -> ASR -> translate -> emit ASS.

Each stage is intentionally a stub. Real implementations land in Phase 1
of the design doc.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class EpisodeJob:
    episode_id: str
    source_url: str
    show_glossary: dict[str, str]


@dataclass
class TranscriptSegment:
    start_ms: int
    end_ms: int
    text: str
    confidence: float


def preprocess_audio(input_path: Path, work_dir: Path) -> Path:
    """ffmpeg extract -> scene-detect OP/ED trim -> Demucs vocals isolation."""
    raise NotImplementedError


def transcribe(audio_path: Path) -> list[TranscriptSegment]:
    """faster-whisper + anime-whisper inference."""
    raise NotImplementedError


def translate(segments: list[TranscriptSegment], glossary: dict[str, str]) -> list[TranscriptSegment]:
    """Claude with episode-level context + show glossary."""
    raise NotImplementedError


def emit_ass(segments: list[TranscriptSegment], out_path: Path) -> None:
    """Write Advanced SubStation Alpha file."""
    raise NotImplementedError


def run(job: EpisodeJob) -> Path:
    raise NotImplementedError
