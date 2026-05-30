<script lang="ts">
  import type { LiveCue, RetimeResult } from "@subtitle-fm/shared/yjs";
  import type { PresenceUser } from "$lib/presence";
  import { formatMs, parseTimecode } from "$lib/format";

  let {
    cue,
    onTextEdit,
    onRetime,
    remoteUsers = [],
    onFocusCue,
  }: {
    cue: LiveCue;
    onTextEdit: (id: string, newText: string) => void;
    onRetime: (id: string, startMs: number, endMs: number) => RetimeResult;
    remoteUsers?: PresenceUser[];
    onFocusCue: (id: string) => void;
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
    const text = cue.text; // read unconditionally so the effect subscribes to cue.text
    if (textEl && document.activeElement !== textEl && textEl.value !== text) {
      textEl.value = text;
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

<li
  class="cue"
  class:needs-review={cue.needsReview}
  class:remote-focused={remoteUsers.length > 0}
  style:--remote-color={remoteUsers[0]?.color ?? "transparent"}
  onfocusin={() => onFocusCue(cue.id)}
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
  <textarea
    class="cue-text"
    bind:this={textEl}
    oninput={handleTextInput}
    oncompositionstart={() => (composing = true)}
    oncompositionend={handleCompositionEnd}
    rows="1"
    aria-label={`cue ${cue.orderIndex + 1} text`}
  ></textarea>
  {#if cue.needsReview}<span class="badge">review</span>{/if}
  {#if remoteUsers.length > 0}
    <span class="remote-labels">
      {#each remoteUsers as u (u.id)}
        <span class="remote-chip" style:background={u.color}>{u.name}</span>
      {/each}
    </span>
  {/if}
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
</style>
