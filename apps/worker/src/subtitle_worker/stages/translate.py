"""Translation stage: Japanese TranscriptSegment[] → English TranscriptSegment[].

Calls Claude with the entire episode's transcript at once (cross-line
context matters more than batching cost for translation quality) plus a
per-show glossary that pins names, terms, attacks, and honorific policy.
The model returns translated text per segment plus a `needs_review` flag;
we OR that with a "low input confidence" rule (`asr_confidence < LOW_CONFIDENCE_THRESHOLD`)
so the editor sees a single flag that fires when EITHER stage is uncertain.

Critical design (per SFM-A-1 and SFM-14):
- ASR runs WITHOUT initial-prompt glossary (anime-whisper degrades with it).
- Glossary is applied here, as post-processing on the source text plus a
  system-prompt instruction. The model can't ignore a glossary line the
  way it might ignore a decoder hint.

Cost target per SFM-A-1: <$0.10 per 22-min episode.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any, Protocol

import structlog

from subtitle_worker.stages.asr import TranscriptSegment

DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_MAX_TOKENS = 16384
LOW_CONFIDENCE_THRESHOLD = 0.37  # matches Whisper's avg_logprob < -1.0 line

log = structlog.get_logger(__name__)


@dataclass(frozen=True)
class GlossaryEntry:
    """One pinned source→target rendering for the translator.

    Mirrors the `glossary_terms` table (packages/db/schema/glossary.ts).
    """

    source_text: str
    target_text: str
    kind: str
    notes: str | None = None


class AnthropicNotAvailable(RuntimeError):
    """Raised when the anthropic SDK cannot be imported."""


class AnthropicClient(Protocol):
    """The slice of the anthropic SDK we actually use.

    Letting callers pass a stub matching this protocol makes the
    orchestrator testable without a real API key.

    Keyword-only call signature so swapping argument order at a stub call
    site can't silently corrupt the request (e.g. user/system getting
    flipped).
    """

    def messages_create(
        self, *, model: str, max_tokens: int, system: str, user: str
    ) -> str:
        """Send one request, return the raw text Claude produced."""
        ...


def check_anthropic_available() -> None:
    """Fail loud if the anthropic SDK isn't installed."""
    try:
        import anthropic  # noqa: F401
    except ImportError as e:
        raise AnthropicNotAvailable(
            "anthropic SDK not importable. Install with `pip install anthropic`. "
            "On RunPod images the SDK is pre-baked into the container."
        ) from e


def build_system_prompt(
    glossary: list[GlossaryEntry],
    style_notes: str | None = None,
) -> str:
    """Compose the system prompt: persona + style guide + glossary + output format.

    Kept as a pure function so it's trivially testable: a given glossary
    must produce a stable string, and every entry must appear in it.
    """
    glossary_block = (
        "\n".join(
            f"- {entry.source_text} → {entry.target_text}"
            + (f"  ({entry.kind})" if entry.kind else "")
            + (f"  // {entry.notes}" if entry.notes else "")
            for entry in glossary
        )
        if glossary
        else "(none provided)"
    )

    base = (
        "You are a professional anime translator. Your task is to translate "
        "Japanese dialogue into English with the polish and naturalness "
        "expected of broadcast subtitles.\n"
        "\n"
        "Style guide:\n"
        "- Preserve speaker register (formal / casual / keigo distinctions).\n"
        "- Drop honorifics by default; keep them (e.g. -san, -kun, -chan) only "
        "when the relationship dynamic is the point of the line.\n"
        "- Match the energy and tone of the source — shouted lines stay loud, "
        "soft lines stay soft.\n"
        "- Use natural English idiom; literal translations are a regression.\n"
        "- Keep proper names exactly as the glossary specifies.\n"
        "\n"
        f"Show glossary (use these renderings exactly):\n{glossary_block}\n"
    )

    if style_notes:
        base += f"\nShow-specific notes:\n{style_notes}\n"

    base += (
        "\n"
        "Output format:\n"
        "You will receive a JSON array of dialogue segments to translate. "
        "Respond with ONLY a JSON object:\n"
        '{"segments": [{"index": N, "text": "translated", '
        '"needs_review": bool}, ...]}\n'
        "- Preserve every input index; output one entry per input segment.\n"
        "- Set needs_review: true when a line is ambiguous, missing context, "
        "or relies on a cultural reference without an obvious equivalent.\n"
        "- Output ONLY the JSON. No commentary, no markdown fences."
    )
    return base


def build_user_prompt(
    segments: list[TranscriptSegment],
    show_title: str | None = None,
) -> str:
    """Pack the segments into the JSON request payload Claude expects."""
    payload = [
        {"index": i, "text": seg.text} for i, seg in enumerate(segments)
    ]
    header = f"Show: {show_title}\n\n" if show_title else ""
    return (
        f"{header}Translate these {len(segments)} dialogue segments to English:\n\n"
        f"{json.dumps(payload, ensure_ascii=False)}"
    )


# Tolerate any language tag in the fence — Claude occasionally emits
# `js` or `javascript` under load despite the prompt instruction.
_FENCE_RE = re.compile(r"^```\w*\s*|\s*```$", re.DOTALL)


def parse_translation_response(raw: str) -> dict[int, tuple[str, bool]]:
    """Parse Claude's JSON response into `{index: (text, needs_review)}`.

    Robust to a couple of common LLM quirks: leading/trailing whitespace,
    a markdown fence around the JSON (which the prompt forbids but
    occasionally appears anyway).

    Raises ValueError on anything we can't recover from — including a
    duplicate index in the response (silently overwriting would lose one
    of the two lines Claude was trying to translate). The caller treats
    this as a stage failure and surfaces the raw output for debug.
    """
    cleaned = _FENCE_RE.sub("", raw.strip())
    try:
        data: Any = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValueError(f"translation response is not valid JSON: {e}") from e

    if not isinstance(data, dict) or "segments" not in data:
        raise ValueError(
            "translation response missing top-level 'segments' key"
        )
    segs = data["segments"]
    if not isinstance(segs, list):
        raise ValueError("'segments' is not a list")

    result: dict[int, tuple[str, bool]] = {}
    for entry in segs:
        if not isinstance(entry, dict):
            raise ValueError(f"segment entry is not an object: {entry!r}")
        idx = entry.get("index")
        text = entry.get("text")
        if not isinstance(idx, int) or not isinstance(text, str):
            raise ValueError(f"segment missing index/text or wrong types: {entry!r}")
        if idx in result:
            raise ValueError(f"duplicate index {idx} in translation response")
        needs_review = bool(entry.get("needs_review", False))
        result[idx] = (text, needs_review)
    return result


def merge_translation(
    sources: list[TranscriptSegment],
    translated: dict[int, tuple[str, bool]],
    low_confidence_threshold: float = LOW_CONFIDENCE_THRESHOLD,
) -> list[TranscriptSegment]:
    """Combine source timing + ASR confidence with translated text + flags.

    For any source index missing from `translated` (model dropped a line),
    pass through the original text and force needs_review=True so the
    editor catches it.
    """
    out: list[TranscriptSegment] = []
    for i, src in enumerate(sources):
        if i in translated:
            text, model_flag = translated[i]
        else:
            text, model_flag = src.text, True  # dropped line — flag for review
        low_input_conf = src.confidence < low_confidence_threshold
        out.append(
            TranscriptSegment(
                start_ms=src.start_ms,
                end_ms=src.end_ms,
                text=text,
                confidence=src.confidence,  # ASR confidence is the source of truth
                needs_review=model_flag or low_input_conf,
            )
        )
    return out


def translate_segments(
    segments: list[TranscriptSegment],
    glossary: list[GlossaryEntry],
    show_title: str | None = None,
    style_notes: str | None = None,
    model: str = DEFAULT_MODEL,
    max_tokens: int = DEFAULT_MAX_TOKENS,
    client: AnthropicClient | None = None,
) -> list[TranscriptSegment]:
    """End-to-end translation: build prompts, call Claude, merge results.

    Pass `client` to inject a stub matching `AnthropicClient` for tests.
    With `client=None` we lazily construct the real anthropic SDK.
    """
    if not segments:
        return []

    system_prompt = build_system_prompt(glossary, style_notes=style_notes)
    user_prompt = build_user_prompt(segments, show_title=show_title)

    log.info(
        "translate.start",
        segments=len(segments),
        glossary_entries=len(glossary),
        model=model,
        show=show_title,
    )
    start = time.monotonic()

    raw = (client or _default_client()).messages_create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        user=user_prompt,
    )

    parsed = parse_translation_response(raw)
    # Surface model misbehavior loudly (Rule 12). Out-of-range indices are
    # silently ignored by merge_translation; logging here keeps the gap
    # diagnosable from production logs alone.
    out_of_range = sorted(i for i in parsed if i < 0 or i >= len(segments))
    if out_of_range:
        log.warning(
            "translate.indices_out_of_range",
            count=len(out_of_range),
            indices=out_of_range[:10],
            source_segments=len(segments),
        )

    merged = merge_translation(segments, parsed)
    dropped = [i for i in range(len(segments)) if i not in parsed]
    flagged = sum(1 for seg in merged if seg.needs_review)

    elapsed = time.monotonic() - start
    log.info(
        "translate.done",
        segments=len(merged),
        flagged_for_review=flagged,
        dropped_by_model=len(dropped),
        elapsed_sec=round(elapsed, 2),
    )
    return merged


def _default_client() -> AnthropicClient:
    """Build the real anthropic-SDK-backed client. Imports the SDK lazily."""
    check_anthropic_available()
    from anthropic import Anthropic

    underlying = Anthropic()

    class _SdkClient:
        def messages_create(
            self, *, model: str, max_tokens: int, system: str, user: str
        ) -> str:
            response = underlying.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            # `content` is a list of mixed block types (TextBlock,
            # ThinkingBlock, ToolUseBlock, ...). Filter on the SDK's
            # `type` discriminator so a future model that returns
            # ThinkingBlock alongside TextBlock doesn't silently drop our
            # output OR include thinking text in the parsed JSON.
            parts: list[str] = []
            for block in response.content:
                if getattr(block, "type", None) == "text":
                    text = getattr(block, "text", "")
                    if isinstance(text, str):
                        parts.append(text)
            return "".join(parts)

    return _SdkClient()
