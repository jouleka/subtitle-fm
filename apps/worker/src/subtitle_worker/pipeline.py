"""Pipeline stages: preprocess -> ASR -> translate -> emit ASS.

The TS worker-runner dispatches per-stage jobs to this Python service on
RunPod. Each stage reads inputs from R2, runs its work, writes outputs back
to R2, and posts a webhook back to the api so the next stage can be
enqueued.

Stage status:
 - preprocess: SFM-12 (extract + trim)
 - vocals: SFM-13 (Demucs isolation)
 - asr: SFM-14 (faster-whisper + anime-whisper)
 - translate: SFM-15 (Claude with show glossary)
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from subtitle_worker.stages.asr import TranscriptSegment, transcribe_audio
from subtitle_worker.stages.preprocess import preprocess_for_asr
from subtitle_worker.stages.translate import GlossaryEntry, translate_segments
from subtitle_worker.stages.vocals import isolate_vocals


@dataclass
class EpisodeJob:
    episode_id: str
    source_url: str
    show_glossary: list[GlossaryEntry]


def preprocess_audio(input_path: Path, work_dir: Path) -> Path:
    """Extract audio + trim OP/ED, then isolate vocals via Demucs.

    Returns the vocals-only WAV path, ready for faster-whisper (SFM-14).
    """
    trimmed = preprocess_for_asr(input_path, work_dir)
    vocals = isolate_vocals(trimmed, work_dir)
    return vocals.vocals_path


def transcribe(audio_path: Path) -> list[TranscriptSegment]:
    """faster-whisper + anime-whisper inference. SFM-14."""
    return transcribe_audio(audio_path)


def translate(
    segments: list[TranscriptSegment],
    glossary: list[GlossaryEntry],
    show_title: str | None = None,
) -> list[TranscriptSegment]:
    """Claude with episode-level context + show glossary. SFM-15."""
    return translate_segments(segments, glossary, show_title=show_title)


def emit_ass(segments: list[TranscriptSegment], out_path: Path) -> None:
    """Write Advanced SubStation Alpha file. Reuses @subtitle-fm/ass conventions."""
    raise NotImplementedError


def run(job: EpisodeJob) -> Path:
    raise NotImplementedError
