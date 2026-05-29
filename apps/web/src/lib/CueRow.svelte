<script lang="ts">
  import type { LiveCue, RetimeResult } from "@subtitle-fm/shared/yjs";
  import { formatMs, parseTimecode } from "$lib/format";

  let {
    cue,
    onTextEdit,
    onRetime,
  }: {
    cue: LiveCue;
    onTextEdit: (id: string, newText: string) => void;
    onRetime: (id: string, startMs: number, endMs: number) => RetimeResult;
  } = $props();

  let textEl: HTMLTextAreaElement | undefined = $state();
  let startEl: HTMLInputElement | undefined = $state();
  let endEl: HTMLInputElement | undefined = $state();

  // IME composition guard. The source language is Japanese — CJK input fires
  // `input` events mid-composition with partial text; applying a diff then
  // would corrupt the Y.Text. Suppress during composition, flush on end.
  let composing = false;

  // Sync external/remote values into a field ONLY when the user isn't editing
  // it. A focused field is the user's — clobbering its value resets the caret.
  // These read cue.* so they re-run on every Y.Doc change.
  $effect(() => {
    if (textEl && document.activeElement !== textEl && textEl.value !== cue.text) {
      textEl.value = cue.text;
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
    if (composing) return;
    if (textEl) onTextEdit(cue.id, textEl.value);
  }

  function handleCompositionEnd() {
    composing = false;
    if (textEl) onTextEdit(cue.id, textEl.value);
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

<li class="cue" class:needs-review={cue.needsReview}>
  <span class="cue-times">
    <input
      class="tc"
      bind:this={startEl}
      onblur={commitStart}
      onkeydown={(e) => onTimeKeydown(e, "start")}
      aria-label="cue start"
    />
    <span class="dash">–</span>
    <input
      class="tc"
      bind:this={endEl}
      onblur={commitEnd}
      onkeydown={(e) => onTimeKeydown(e, "end")}
      aria-label="cue end"
    />
  </span>
  <textarea
    class="cue-text"
    bind:this={textEl}
    oninput={handleTextInput}
    oncompositionstart={() => (composing = true)}
    oncompositionend={handleCompositionEnd}
    rows="1"
    aria-label="cue text"
  ></textarea>
  {#if cue.needsReview}<span class="badge">review</span>{/if}
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
  .cue-text {
    flex: 1;
    font: inherit;
    resize: vertical;
    min-height: 1.6rem;
    padding: 0.2rem 0.3rem;
    border: 1px solid #ddd;
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
</style>
