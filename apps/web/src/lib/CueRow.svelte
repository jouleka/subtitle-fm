<script lang="ts">
  import type { LiveCue, RetimeResult } from "@subtitle-fm/shared/yjs";
  import type { PresenceUser } from "$lib/presence";
  import { formatMs, parseTimecode } from "$lib/format";
  import { segmentOverrideTags } from "$lib/override-tags";
  import { classifyCueKeydown } from "$lib/cue-keys";

  let {
    cue,
    onTextEdit,
    onRetime,
    remoteUsers = [],
    onFocusCue,
    onClearReview,
    onSplitCue,
    onMoveCue,
    onNavCue,
    onInsertCue,
    onDeleteCue,
  }: {
    cue: LiveCue;
    onTextEdit: (id: string, newText: string) => void;
    onRetime: (id: string, startMs: number, endMs: number) => RetimeResult;
    remoteUsers?: PresenceUser[];
    onFocusCue: (id: string) => void;
    onClearReview: (id: string) => void;
    onSplitCue: (id: string, caretOffset: number) => void;
    onMoveCue: (id: string, direction: "up" | "down") => void;
    onNavCue: (id: string, direction: "prev" | "next") => void;
    onInsertCue: (id: string) => void;
    onDeleteCue: (id: string) => void;
  } = $props();

  let textEl: HTMLTextAreaElement | undefined = $state();
  let startEl: HTMLInputElement | undefined = $state();
  let endEl: HTMLInputElement | undefined = $state();
  let highlightEl: HTMLDivElement | undefined = $state();

  // IME composition guard. The source language is Japanese — CJK input fires
  // `input` events mid-composition with partial text; applying a diff then
  // would corrupt the Y.Text. Suppress during composition, flush on end.
  let composing = false;

  // Backdrop mirror of the textarea's *visible* value. MUST be $state (assigned
  // reactively; the backdrop {#each} must re-render on change). highlightText
  // runs ahead of cue.text while the field is focused, until the Y.Doc
  // round-trips back through the sync effect below. Seeding from cue.text reads
  // it once (Svelte's state_referenced_locally warning is expected/benign) — the
  // sync $effect + handlers keep it current after mount.
  let highlightText = $state(cue.text);
  const segments = $derived(segmentOverrideTags(highlightText));

  // SINGLE programmatic writer of the textarea value — also updates the mirror,
  // so the transparent textarea and the backdrop that paints its text can never
  // desync. Any future imperative `textEl.value =` write MUST go through here.
  function showText(v: string) {
    if (textEl) textEl.value = v;
    highlightText = v;
  }

  function syncScroll() {
    if (textEl && highlightEl) {
      highlightEl.scrollTop = textEl.scrollTop;
      highlightEl.scrollLeft = textEl.scrollLeft;
    }
  }

  // Sync external/remote values into a field ONLY when the user isn't editing
  // it. A focused field is the user's — clobbering its value resets the caret.
  // These read cue.* so they re-run on every Y.Doc change.
  $effect(() => {
    const text = cue.text; // read unconditionally so the effect subscribes to cue.text
    if (textEl && document.activeElement !== textEl && textEl.value !== text) {
      showText(text); // sets textEl.value AND highlightText (the only programmatic writer)
    }
  });
  $effect(() => {
    const tc = formatMs(cue.startMs);
    if (startEl && document.activeElement !== startEl && startEl.value !== tc) {
      startEl.value = tc;
    }
  });
  $effect(() => {
    const tc = formatMs(cue.endMs);
    if (endEl && document.activeElement !== endEl && endEl.value !== tc) {
      endEl.value = tc;
    }
  });

  function handleTextInput() {
    if (textEl) highlightText = textEl.value; // mirror the visible value, always
    if (composing) return;
    if (textEl) onTextEdit(cue.id, textEl.value);
  }

  function handleCompositionEnd() {
    composing = false;
    if (textEl) {
      highlightText = textEl.value;
      onTextEdit(cue.id, textEl.value);
    }
  }

  function handleTextKeydown(e: KeyboardEvent) {
    const caretAtEnd = textEl ? textEl.selectionStart === textEl.value.length : false;
    const action = classifyCueKeydown(e, composing, caretAtEnd); // `composing` is the existing IME flag
    if (action.type === "none") return; // normal typing
    e.preventDefault();
    if (action.type === "split") {
      if (textEl) onSplitCue(cue.id, textEl.selectionStart ?? textEl.value.length);
    } else if (action.type === "insert") {
      onInsertCue(cue.id);
    } else if (action.type === "move") {
      onMoveCue(cue.id, action.direction);
    } else if (action.type === "nav") {
      onNavCue(cue.id, action.direction);
    } else if (textEl) {
      // Shift+Enter inserts the .ass hard line break "\N" — a LITERAL newline makes
      // serializeAss throw (live JASSUB preview + publish). The synthetic input event
      // drives handleTextInput → onTextEdit → applyCueTextEdit (collaborative-safe).
      const start = textEl.selectionStart ?? textEl.value.length;
      const end = textEl.selectionEnd ?? start;
      textEl.setRangeText("\\N", start, end, "end");
      textEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function commitStart() {
    if (!startEl) return;
    const ms = parseTimecode(startEl.value);
    if (ms === null) {
      startEl.value = formatMs(cue.startMs);
      return;
    }
    const result = onRetime(cue.id, ms, cue.endMs);
    startEl.value = formatMs(result.ok ? result.startMs : cue.startMs);
  }

  function commitEnd() {
    if (!endEl) return;
    const ms = parseTimecode(endEl.value);
    if (ms === null) {
      endEl.value = formatMs(cue.endMs);
      return;
    }
    const result = onRetime(cue.id, cue.startMs, ms);
    endEl.value = formatMs(result.ok ? result.endMs : cue.endMs);
  }

  function onTimeKeydown(e: KeyboardEvent, which: "start" | "end") {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget as HTMLInputElement).blur(); // fires the onblur commit
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const step = (e.shiftKey ? 100 : 10) * (e.key === "ArrowUp" ? 1 : -1);
    const result =
      which === "start"
        ? onRetime(cue.id, cue.startMs + step, cue.endMs)
        : onRetime(cue.id, cue.startMs, cue.endMs + step);
    const el = which === "start" ? startEl : endEl;
    if (el && result.ok) {
      el.value = formatMs(which === "start" ? result.startMs : result.endMs);
    }
  }
</script>

<li
  class="cue"
  class:needs-review={cue.needsReview}
  class:remote-focused={remoteUsers.length > 0}
  style:--remote-color={remoteUsers[0]?.color ?? "transparent"}
  onfocusin={() => onFocusCue(cue.id)}
  data-cue-id={cue.id}
>
  <span class="cue-times">
    <input
      class="tc"
      bind:this={startEl}
      onblur={commitStart}
      onkeydown={(e) => onTimeKeydown(e, "start")}
      aria-label={`cue ${cue.orderIndex + 1} start`}
    />
    <span class="dash">–</span>
    <input
      class="tc"
      bind:this={endEl}
      onblur={commitEnd}
      onkeydown={(e) => onTimeKeydown(e, "end")}
      aria-label={`cue ${cue.orderIndex + 1} end`}
    />
  </span>
  <div class="cue-text-wrap">
    <!-- The backdrop paints the cue text; the {#each} below MUST stay on a single
         line with no whitespace between the spans. This div is white-space:pre-wrap,
         so any stray template whitespace would render as glyphs and break alignment. -->
    <div class="cue-text-highlight" bind:this={highlightEl} aria-hidden="true">{#each segments as seg}<span class:tag={seg.kind === "tag"}>{seg.value}</span>{/each}</div>
    <textarea
      class="cue-text"
      bind:this={textEl}
      oninput={handleTextInput}
      onkeydown={handleTextKeydown}
      oncompositionstart={() => (composing = true)}
      oncompositionend={handleCompositionEnd}
      onscroll={syncScroll}
      rows="1"
      aria-label={`cue ${cue.orderIndex + 1} text`}
    ></textarea>
  </div>
  {#if cue.needsReview}<button type="button" class="badge review-btn" onclick={() => onClearReview(cue.id)}>Mark reviewed</button>{/if}
  {#if remoteUsers.length > 0}
    <span class="remote-labels">
      {#each remoteUsers as u (u.id)}
        <span class="remote-chip" style:background={u.color}>{u.name}</span>
      {/each}
    </span>
  {/if}
  <button type="button" class="cue-delete" aria-label={`Delete cue ${cue.orderIndex + 1}`} onclick={() => onDeleteCue(cue.id)}>🗑</button>
</li>

<style>
  .cue {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
    padding: 0.5rem;
    border-bottom: 1px solid #eee;
  }
  .cue.needs-review {
    border-left: 3px solid #f4b400;
    padding-left: 0.5rem;
  }
  .cue-times {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex: 0 0 auto;
  }
  .tc {
    font-family: ui-monospace, monospace;
    width: 8ch;
    padding: 0.1rem 0.2rem;
    border: 1px solid #ddd;
    border-radius: 3px;
  }
  .dash {
    color: #666;
  }
  .cue-text-wrap {
    position: relative;
    flex: 1;
  }
  /* Backdrop and textarea MUST share an identical text box so glyphs line up. */
  .cue-text-highlight,
  .cue-text {
    font: inherit;
    line-height: 1.5;
    tab-size: 2;
    min-height: 1.6rem;
    padding: 0.2rem 0.3rem;
    border: 1px solid transparent;
    border-radius: 3px;
    box-sizing: border-box;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    width: 100%;
  }
  .cue-text-highlight {
    position: absolute;
    inset: 0;
    margin: 0;
    overflow: hidden;
    pointer-events: none;
    color: #222;
    user-select: none;
  }
  .cue-text {
    position: relative;
    margin: 0;
    background: transparent;
    color: transparent;
    caret-color: #222;
    border-color: #ddd;
    resize: vertical;
    overflow-x: hidden;        /* break-word prevents h-scroll anyway; guards the backdrop (overflow:hidden) from a scrollLeft mismatch */
    overflow-y: auto;
    scrollbar-width: none;
  }
  .cue-text::-webkit-scrollbar {
    display: none;
  }
  .cue-text-highlight .tag {
    background: #eef2ff;
    color: #3730a3;
    border-radius: 3px;
  }
  .badge {
    background: #f4b400;
    color: #222;
    font-size: 0.7rem;
    padding: 0 0.35rem;
    border-radius: 4px;
    align-self: center;
  }
  .review-btn {
    border: none;
    cursor: pointer;
    font: inherit;
    font-size: 0.7rem;
  }
  .cue.remote-focused {
    outline: 2px solid var(--remote-color);
    outline-offset: -2px;
  }
  .remote-labels {
    display: inline-flex;
    gap: 0.25rem;
    align-self: center;
    flex-wrap: wrap;
  }
  .remote-chip {
    font-size: 0.65rem;
    padding: 0 0.35rem;
    border-radius: 999px;
    color: white;
    white-space: nowrap;
  }
  .cue-delete {
    align-self: center;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 0.8rem;
    opacity: 0.5;
    padding: 0 0.2rem;
  }
  .cue-delete:hover {
    opacity: 1;
  }
</style>
