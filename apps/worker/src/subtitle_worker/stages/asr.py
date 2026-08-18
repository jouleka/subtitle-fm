"""ASR stage: vocals WAV → list of TranscriptSegment.

Uses faster-whisper (CTranslate2 backend) with `litagin/anime-whisper`,
a 756M-param Whisper variant distilled from kotoba-whisper-v2.0 and
trained on 5,300 hours of galgame / anime VA data. Anime-whisper hits
~13% CER on anime test sets vs ~16.5% for vanilla Whisper-large-v3
(per SFM-A-1 design doc).

Critical design call: anime-whisper degrades with initial-prompt
glossary (documented on the model card). Glossary application happens
in the translation stage (SFM-15) via post-processing, NOT as a decoder
hint here.

Silero VAD (`vad_filter=True`) is enabled — reduces hallucination on
long silences and on any OP/ED residue that survived the preprocess
trim. Tighter than the WhisperX alignment path, which has known
regressions on Japanese in 2026.

Note on model format: `litagin/anime-whisper` ships as a HuggingFace
transformers checkpoint. faster-whisper expects CTranslate2 format,
so the RunPod image build should pre-convert via
`ct2-transformers-converter --model litagin/anime-whisper --output_dir
/models/anime-whisper-ct2` and set `ASR_MODEL_PATH` to that directory.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass
from pathlib import Path

import structlog

DEFAULT_MODEL_PATH = "litagin/anime-whisper"
DEFAULT_LANGUAGE = "ja"
DEFAULT_DEVICE: str | None = None  # None → faster-whisper auto-picks CUDA/CPU
DEFAULT_COMPUTE_TYPE = "float16"  # GPU default; switch to "int8" for CPU
DEFAULT_BEAM_SIZE = 5
DEFAULT_VAD_MIN_SILENCE_MS = 500

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class TranscriptSegment:
    """One dialogue segment as it flows through ASR → translate → DB.

    Times are integer milliseconds (matches the DB schema's `cues.startMs` /
    `cues.endMs` columns). `confidence` is `exp(avg_logprob)` — the
    geometric mean of per-token probabilities, NOT a joint probability.
    Values are in (0, 1]; below ~0.37 (Whisper's own low-confidence line)
    are typically flagged for human review by the translation stage.

    `needs_review` defaults False — ASR doesn't set it (the threshold is
    applied at the translate stage so the human + machine flags converge
    on one boolean by the time the editor sees it).
    """

    start_ms: int
    end_ms: int
    text: str
    confidence: float
    needs_review: bool = False


class FasterWhisperNotAvailable(RuntimeError):
    """Raised when faster-whisper cannot be imported (no torch / no install)."""


def check_faster_whisper_available() -> None:
    """Fail loud if faster-whisper isn't installed.

    Heavy install (CTranslate2 + torch). Local dev without ASR can skip it
    and use the rest of the pipeline.
    """
    try:
        import faster_whisper  # type: ignore[import-untyped]  # noqa: F401
    except ImportError as e:
        raise FasterWhisperNotAvailable(
            "faster-whisper not importable. Install with "
            "`pip install faster-whisper` (pulls in torch / ctranslate2). "
            "On RunPod images the stack is pre-baked into the container."
        ) from e


def logprob_to_confidence(avg_logprob: float) -> float:
    """Map Whisper's natural-log avg probability to a [0, 1] confidence.

    Whisper emits `avg_logprob` as a natural log; exp() inverts it back
    to a probability. Typical ranges:
      avg_logprob = 0.0  → confidence = 1.0
      avg_logprob = -0.5 → confidence ≈ 0.61
      avg_logprob = -1.0 → confidence ≈ 0.37   (Whisper's own "low-confidence" line)
      avg_logprob = -2.0 → confidence ≈ 0.14

    Coerces the result to native `float` — guards against the historical
    case where Whisper returned numpy floats (which don't serialize cleanly
    to JSON / Postgres). faster-whisper 1.x's Segment.avg_logprob is
    already a Python float, so the cast is belt-and-suspenders.
    """
    return float(math.exp(avg_logprob))


def transcribe_audio(
    audio_path: Path,
    model_path: str = DEFAULT_MODEL_PATH,
    language: str = DEFAULT_LANGUAGE,
    device: str | None = DEFAULT_DEVICE,
    compute_type: str = DEFAULT_COMPUTE_TYPE,
    beam_size: int = DEFAULT_BEAM_SIZE,
) -> list[TranscriptSegment]:
    """Transcribe `audio_path` with faster-whisper + anime-whisper.

    Returns segments in chronological order with millisecond timestamps
    and confidence in [0, 1].
    """
    check_faster_whisper_available()

    # Lazy import so the module loads in environments without ctranslate2/torch.
    from faster_whisper import WhisperModel

    log.info(
        "asr.transcribe.start",
        audio=str(audio_path),
        model=model_path,
        language=language,
        device=device or "auto",
        compute_type=compute_type,
        beam_size=beam_size,
    )
    start = time.monotonic()

    # Omit `device` when None so WhisperModel picks its own default
    # ("cuda" if available else "cpu"). Passing the kwarg explicitly
    # would skip that check and hard-fail on a CPU-only box.
    model_kwargs: dict[str, object] = {"compute_type": compute_type}
    if device is not None:
        model_kwargs["device"] = device
    # Per-call model construction is intentional: on RunPod serverless each
    # invocation is its own container, so an in-process cache would buy
    # nothing here. Revisit if/when we add a local batch-processing path.
    model = WhisperModel(model_path, **model_kwargs)

    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        beam_size=beam_size,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": DEFAULT_VAD_MIN_SILENCE_MS},
        # NB: do NOT add initial_prompt — anime-whisper documents that
        # initial-prompt glossary causes a quality decline. Glossary
        # application is post-processing in the translate stage (SFM-15).
    )

    results: list[TranscriptSegment] = []
    for seg in segments_iter:
        results.append(
            TranscriptSegment(
                start_ms=round(seg.start * 1000),
                end_ms=round(seg.end * 1000),
                text=seg.text.strip(),
                confidence=logprob_to_confidence(seg.avg_logprob),
            )
        )

    elapsed = time.monotonic() - start
    log.info(
        "asr.transcribe.done",
        audio=str(audio_path),
        segments=len(results),
        elapsed_sec=round(elapsed, 2),
        detected_language=info.language,
    )
    return results
