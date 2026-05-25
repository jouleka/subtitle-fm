"""Tests for the translation stage.

Pure helpers (prompt building, response parsing, source/target merging,
ImportError path) run unconditionally. The full `translate_segments`
orchestrator runs against an injected stub `AnthropicClient` — no real
Claude API calls, no key needed.
"""

from __future__ import annotations

import json
import sys

import pytest

from subtitle_worker.stages.asr import TranscriptSegment
from subtitle_worker.stages.translate import (
    DEFAULT_MODEL,
    DEFAULT_OPENAI_MODEL,
    LOW_CONFIDENCE_THRESHOLD,
    AnthropicNotAvailable,
    GlossaryEntry,
    OpenAINotAvailable,
    _resolve_provider,
    build_system_prompt,
    build_user_prompt,
    check_anthropic_available,
    check_openai_available,
    merge_translation,
    parse_translation_response,
    translate_segments,
)


# ---------------------------------------------------------------------------
# build_system_prompt
# ---------------------------------------------------------------------------


class TestBuildSystemPrompt:
    def test_includes_every_glossary_entry(self) -> None:
        glossary = [
            GlossaryEntry(source_text="キルア", target_text="Killua", kind="name"),
            GlossaryEntry(
                source_text="念", target_text="Nen", kind="term", notes="aura energy"
            ),
        ]
        prompt = build_system_prompt(glossary)
        # Both source and target text must appear (would be the bug if the
        # template silently dropped one side).
        assert "キルア" in prompt
        assert "Killua" in prompt
        assert "念" in prompt
        assert "Nen" in prompt
        # Notes should surface when present so the model has the disambiguation.
        assert "aura energy" in prompt

    def test_handles_empty_glossary(self) -> None:
        prompt = build_system_prompt([])
        # Must still emit something readable, not a blank placeholder.
        assert "none provided" in prompt.lower() or "(none)" in prompt.lower()

    def test_includes_style_notes_when_provided(self) -> None:
        prompt = build_system_prompt([], style_notes="This show uses heavy slang.")
        assert "heavy slang" in prompt

    def test_omits_style_notes_section_when_none(self) -> None:
        prompt = build_system_prompt([])
        assert "Show-specific notes" not in prompt

    def test_specifies_strict_json_output(self) -> None:
        # The parser depends on Claude returning bare JSON. The prompt must
        # be explicit about it; a regression here breaks the whole stage.
        prompt = build_system_prompt([])
        assert "ONLY the JSON" in prompt or "ONLY a JSON" in prompt


# ---------------------------------------------------------------------------
# build_user_prompt
# ---------------------------------------------------------------------------


class TestBuildUserPrompt:
    def _segs(self) -> list[TranscriptSegment]:
        return [
            TranscriptSegment(start_ms=0, end_ms=1000, text="こんにちは", confidence=0.9),
            TranscriptSegment(start_ms=1000, end_ms=2000, text="さようなら", confidence=0.8),
        ]

    def test_payload_is_valid_json_with_indices(self) -> None:
        prompt = build_user_prompt(self._segs())
        # Extract the JSON payload from the prompt.
        json_start = prompt.index("[")
        payload = json.loads(prompt[json_start:])
        assert payload == [
            {"index": 0, "text": "こんにちは"},
            {"index": 1, "text": "さようなら"},
        ]

    def test_includes_show_title_when_provided(self) -> None:
        prompt = build_user_prompt(self._segs(), show_title="Hunter x Hunter")
        assert "Hunter x Hunter" in prompt

    def test_omits_show_line_when_no_title(self) -> None:
        prompt = build_user_prompt(self._segs())
        assert not prompt.startswith("Show:")

    def test_segment_count_announced(self) -> None:
        prompt = build_user_prompt(self._segs())
        assert "2 dialogue segments" in prompt


# ---------------------------------------------------------------------------
# parse_translation_response
# ---------------------------------------------------------------------------


class TestParseTranslationResponse:
    def test_parses_well_formed_response(self) -> None:
        raw = json.dumps(
            {
                "segments": [
                    {"index": 0, "text": "Hello", "needs_review": False},
                    {"index": 1, "text": "Goodbye", "needs_review": True},
                ]
            }
        )
        result = parse_translation_response(raw)
        assert result == {0: ("Hello", False), 1: ("Goodbye", True)}

    def test_strips_leading_and_trailing_whitespace(self) -> None:
        raw = '   {"segments": [{"index": 0, "text": "x", "needs_review": false}]}   '
        result = parse_translation_response(raw)
        assert result == {0: ("x", False)}

    def test_strips_markdown_fence_when_present(self) -> None:
        # The prompt forbids fences but Claude occasionally emits them.
        # If the parser doesn't tolerate them the whole stage fails on a
        # cosmetic issue.
        raw = '```json\n{"segments": [{"index": 0, "text": "x"}]}\n```'
        result = parse_translation_response(raw)
        assert result == {0: ("x", False)}  # needs_review defaults to False

    def test_defaults_needs_review_to_false_when_omitted(self) -> None:
        raw = json.dumps({"segments": [{"index": 0, "text": "x"}]})
        assert parse_translation_response(raw) == {0: ("x", False)}

    def test_raises_on_invalid_json(self) -> None:
        with pytest.raises(ValueError):
            parse_translation_response("not json at all")

    def test_raises_on_missing_segments_key(self) -> None:
        with pytest.raises(ValueError, match="segments"):
            parse_translation_response(json.dumps({"results": []}))

    def test_raises_on_non_list_segments(self) -> None:
        with pytest.raises(ValueError, match="list"):
            parse_translation_response(json.dumps({"segments": {}}))

    def test_raises_on_missing_index_or_text(self) -> None:
        with pytest.raises(ValueError):
            parse_translation_response(json.dumps({"segments": [{"text": "x"}]}))
        with pytest.raises(ValueError):
            parse_translation_response(json.dumps({"segments": [{"index": 0}]}))

    def test_raises_on_duplicate_index(self) -> None:
        # Intent: silent overwrite would lose one of the two lines Claude
        # tried to translate. Fail loud (Rule 12) so the retry has a
        # chance to do better.
        raw = json.dumps(
            {
                "segments": [
                    {"index": 0, "text": "first"},
                    {"index": 0, "text": "second"},
                ]
            }
        )
        with pytest.raises(ValueError, match="duplicate"):
            parse_translation_response(raw)

    def test_strips_alternate_language_fence(self) -> None:
        # Claude occasionally emits ```js or ```javascript despite "ONLY
        # the JSON" instruction. Parser should tolerate any \w* tag.
        raw = '```javascript\n{"segments": [{"index": 0, "text": "x"}]}\n```'
        assert parse_translation_response(raw) == {0: ("x", False)}


# ---------------------------------------------------------------------------
# merge_translation
# ---------------------------------------------------------------------------


class TestMergeTranslation:
    def _sources(self) -> list[TranscriptSegment]:
        return [
            TranscriptSegment(start_ms=0, end_ms=1000, text="A", confidence=0.9),
            TranscriptSegment(start_ms=1000, end_ms=2000, text="B", confidence=0.2),
        ]

    def test_replaces_text_preserves_timing_and_confidence(self) -> None:
        merged = merge_translation(
            self._sources(),
            {0: ("Alpha", False), 1: ("Beta", False)},
        )
        assert merged[0].text == "Alpha"
        assert merged[0].start_ms == 0
        assert merged[0].end_ms == 1000
        assert merged[0].confidence == 0.9

    def test_passes_through_source_text_when_index_missing(self) -> None:
        # Model dropped index 1: keep the source text + force review flag.
        merged = merge_translation(self._sources(), {0: ("Alpha", False)})
        assert merged[1].text == "B"  # original Japanese
        assert merged[1].needs_review is True

    def test_low_input_confidence_forces_review_flag(self) -> None:
        # Index 1 has confidence 0.2 (well below 0.37 threshold). Even if
        # the model says "no review needed", the low ASR confidence wins.
        merged = merge_translation(
            self._sources(),
            {0: ("Alpha", False), 1: ("Beta", False)},
        )
        assert merged[0].needs_review is False  # 0.9 > 0.37
        assert merged[1].needs_review is True  # 0.2 < 0.37

    def test_model_flag_OR_input_confidence(self) -> None:
        # High ASR confidence but model flagged → still flagged.
        sources = [
            TranscriptSegment(start_ms=0, end_ms=1, text="A", confidence=0.95),
        ]
        merged = merge_translation(sources, {0: ("Alpha", True)})
        assert merged[0].needs_review is True

    def test_threshold_is_strict_less_than(self) -> None:
        # Exactly at threshold → NOT flagged (strict <).
        sources = [
            TranscriptSegment(
                start_ms=0, end_ms=1, text="A", confidence=LOW_CONFIDENCE_THRESHOLD
            ),
        ]
        merged = merge_translation(sources, {0: ("Alpha", False)})
        assert merged[0].needs_review is False


# ---------------------------------------------------------------------------
# check_anthropic_available
# ---------------------------------------------------------------------------


def test_check_anthropic_available_raises_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(sys.modules, "anthropic", None)
    with pytest.raises(AnthropicNotAvailable) as exc_info:
        check_anthropic_available()
    assert "anthropic" in str(exc_info.value)


# ---------------------------------------------------------------------------
# translate_segments end-to-end with injected stub client
# ---------------------------------------------------------------------------


class StubClient:
    """Minimal LLMClient stub; captures the request, returns a fixed body.

    Keyword-only signature mirrors the Protocol exactly so a future
    refactor that adds positional-arg validation surfaces a mismatch.
    """

    def __init__(self, response_text: str) -> None:
        self.response_text = response_text
        self.last_call: dict[str, object] = {}

    def messages_create(
        self, *, model: str, max_tokens: int, system: str, user: str
    ) -> str:
        self.last_call = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system,
            "user": user,
        }
        return self.response_text


def test_translate_segments_empty_input_short_circuits() -> None:
    # Don't burn a Claude call on an empty episode (shouldn't happen but
    # don't make it our problem).
    client = StubClient(response_text="should not be called")
    out = translate_segments([], [], client=client)
    assert out == []
    assert client.last_call == {}


def test_translate_segments_passes_glossary_into_system_prompt() -> None:
    sources = [
        TranscriptSegment(start_ms=0, end_ms=1, text="ナルト", confidence=0.9),
    ]
    glossary = [GlossaryEntry(source_text="ナルト", target_text="Naruto", kind="name")]
    response = json.dumps({"segments": [{"index": 0, "text": "Naruto", "needs_review": False}]})
    client = StubClient(response_text=response)
    out = translate_segments(sources, glossary, client=client, model="claude-test")

    assert out[0].text == "Naruto"
    # The glossary made it into the system prompt.
    assert "ナルト" in str(client.last_call["system"])
    assert "Naruto" in str(client.last_call["system"])
    # Caller-supplied model overrides default.
    assert client.last_call["model"] == "claude-test"


def test_translate_segments_propagates_parse_error() -> None:
    sources = [TranscriptSegment(start_ms=0, end_ms=1, text="x", confidence=0.9)]
    client = StubClient(response_text="not json")
    with pytest.raises(ValueError):
        translate_segments(sources, [], client=client)


# ---------------------------------------------------------------------------
# Defaults pinning
# ---------------------------------------------------------------------------


def test_default_model_is_pinned() -> None:
    # Surfacing default-model bumps in PR diffs prevents silent quality
    # regressions when a new Claude version ships.
    assert DEFAULT_MODEL == "claude-sonnet-4-6"


def test_default_openai_model_is_pinned_to_snapshot() -> None:
    # Pin a dated snapshot, NOT the bare `gpt-4o` alias — the alias has
    # historically routed to a 4096-output snapshot which silently
    # truncates long episode JSON and breaks parse_translation_response.
    assert DEFAULT_OPENAI_MODEL == "gpt-4o-2024-08-06"


def test_low_confidence_threshold_matches_whisper_baseline() -> None:
    # 0.37 ≈ exp(-1.0) — Whisper's own "low confidence" line. If the SFM-14
    # confidence semantics change, this value must change too.
    import math

    assert LOW_CONFIDENCE_THRESHOLD == pytest.approx(math.exp(-1.0), abs=0.01)


# ---------------------------------------------------------------------------
# Provider resolution
# ---------------------------------------------------------------------------


class TestResolveProvider:
    """Tests don't actually call OpenAI/Anthropic — they verify the routing
    by checking which `check_*_available` would be triggered. We monkeypatch
    those to throw `Skip` so a passing/failing match indicates which branch
    was selected.
    """

    def test_raises_when_no_provider_configured(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("LLM_PROVIDER", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        with pytest.raises(RuntimeError, match="No LLM provider"):
            _resolve_provider(None)

    def test_explicit_provider_claude_overrides_openai_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # LLM_PROVIDER=claude must win even if only OPENAI_API_KEY is set.
        monkeypatch.setenv("LLM_PROVIDER", "claude")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")  # required by precheck
        called = {"anthropic": False, "openai": False}
        import subtitle_worker.stages.translate as t

        monkeypatch.setattr(t, "_build_anthropic_client", lambda: called.__setitem__("anthropic", True) or "ANTH")
        monkeypatch.setattr(t, "_build_openai_client", lambda: called.__setitem__("openai", True) or "OAI")
        client, model = _resolve_provider(None)
        assert client == "ANTH"
        assert model == DEFAULT_MODEL
        assert called == {"anthropic": True, "openai": False}

    def test_explicit_provider_openai_overrides_anthropic_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")  # required by precheck
        import subtitle_worker.stages.translate as t

        monkeypatch.setattr(t, "_build_anthropic_client", lambda: "ANTH")
        monkeypatch.setattr(t, "_build_openai_client", lambda: "OAI")
        client, model = _resolve_provider(None)
        assert client == "OAI"
        assert model == DEFAULT_OPENAI_MODEL

    def test_explicit_claude_without_anth_key_raises_actionable_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Friendlier than letting Anthropic() throw a generic "no API key"
        # from inside the SDK.
        monkeypatch.setenv("LLM_PROVIDER", "claude")
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")  # red herring
        with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
            _resolve_provider(None)

    def test_explicit_openai_without_openai_key_raises_actionable_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")  # red herring
        with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
            _resolve_provider(None)

    def test_auto_picks_anthropic_when_only_anth_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("LLM_PROVIDER", raising=False)
        monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        import subtitle_worker.stages.translate as t

        monkeypatch.setattr(t, "_build_anthropic_client", lambda: "ANTH")
        monkeypatch.setattr(t, "_build_openai_client", lambda: "OAI")
        client, _ = _resolve_provider(None)
        assert client == "ANTH"

    def test_auto_picks_openai_when_only_openai_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("LLM_PROVIDER", raising=False)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        import subtitle_worker.stages.translate as t

        monkeypatch.setattr(t, "_build_anthropic_client", lambda: "ANTH")
        monkeypatch.setattr(t, "_build_openai_client", lambda: "OAI")
        client, model = _resolve_provider(None)
        assert client == "OAI"
        assert model == DEFAULT_OPENAI_MODEL

    def test_explicit_model_overrides_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("LLM_PROVIDER", "openai")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        import subtitle_worker.stages.translate as t

        monkeypatch.setattr(t, "_build_openai_client", lambda: "OAI")
        _, model = _resolve_provider("gpt-4o-mini")
        assert model == "gpt-4o-mini"


def test_check_openai_available_raises_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(sys.modules, "openai", None)
    with pytest.raises(OpenAINotAvailable):
        check_openai_available()
