<script lang="ts">
  import { formatMs } from '$lib/format';
  import type {
    CueConflictChoice,
    CueConflictResolution,
    CueListDiffRow,
  } from '@subtitle-fm/shared';
  import { m } from '$lib/paraglide/messages';

  type Draft = { choice: CueConflictChoice | null; manualText: string };

  let {
    branchName,
    conflicts,
    busy = false,
    onCancel,
    onResolve,
  }: {
    branchName: string;
    conflicts: CueListDiffRow[];
    busy?: boolean;
    onCancel: () => void;
    onResolve: (resolutions: CueConflictResolution[]) => void;
  } = $props();

  let index = $state(0);
  let drafts = $state<Record<string, Draft>>({});
  const current = $derived(conflicts[index]!);
  const currentDraft = $derived(drafts[current.key] ?? { choice: null, manualText: '' });
  const resolvedCount = $derived(conflicts.filter((row) => drafts[row.key]?.choice).length);
  const canSubmit = $derived(resolvedCount === conflicts.length && !busy);

  function choose(choice: CueConflictChoice) {
    const existing = drafts[current.key];
    const suggested = current.ours?.text ?? current.theirs?.text ?? current.base?.text ?? '';
    drafts = {
      ...drafts,
      [current.key]: {
        choice,
        manualText: existing?.manualText || (choice === 'manual' ? suggested : ''),
      },
    };
  }

  function updateManual(manualText: string) {
    drafts = { ...drafts, [current.key]: { choice: 'manual', manualText } };
  }

  function submit() {
    if (!canSubmit) return;
    onResolve(
      conflicts.map((row) => {
        const draft = drafts[row.key]!;
        return {
          key: row.key,
          choice: draft.choice!,
          ...(draft.choice === 'manual' ? { manualText: draft.manualText } : {}),
        };
      }),
    );
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === 'Escape' && !busy) onCancel();
  }}
/>

<div class="backdrop" role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="resolution-title">
    <header>
      <div>
        <p class="eyebrow">{m.conflict_number({ current: index + 1, total: conflicts.length })}</p>
        <h2 id="resolution-title">{m.conflict_resolve({ branch: branchName })}</h2>
        <p class="anchor">{m.conflict_cue_at({ time: formatMs(current.anchorMs) })}</p>
      </div>
      <button class="close" aria-label={m.conflict_close()} disabled={busy} onclick={onCancel}>×</button>
    </header>

    <div class="versions">
      <article>
        <h3>{m.conflict_base()}</h3>
        <pre>{current.base?.text ?? m.conflict_cue_absent()}</pre>
      </article>
      <article>
        <h3>{m.conflict_live()}</h3>
        <pre>{current.ours?.text ?? m.conflict_cue_removed()}</pre>
      </article>
      <article>
        <h3>{m.conflict_branch()}</h3>
        <pre>{current.theirs?.text ?? m.conflict_cue_removed()}</pre>
      </article>
    </div>

    <fieldset>
      <legend>{m.conflict_choose()}</legend>
      <div class="choices">
        <button
          class:selected={currentDraft.choice === 'ours'}
          aria-pressed={currentDraft.choice === 'ours'}
          onclick={() => choose('ours')}
        >{m.conflict_use_live()}</button>
        <button
          class:selected={currentDraft.choice === 'theirs'}
          aria-pressed={currentDraft.choice === 'theirs'}
          onclick={() => choose('theirs')}
        >{m.conflict_use_branch()}</button>
        <button
          class:selected={currentDraft.choice === 'manual'}
          aria-pressed={currentDraft.choice === 'manual'}
          onclick={() => choose('manual')}
        >{m.conflict_write_manual()}</button>
      </div>
      {#if currentDraft.choice === 'manual'}
        <label class="manual">
          <span>{m.conflict_manual_text()}</span>
          <textarea
            rows="4"
            value={currentDraft.manualText}
            oninput={(event) => updateManual(event.currentTarget.value)}
          ></textarea>
        </label>
      {/if}
    </fieldset>

    <footer>
      <span>{m.conflict_resolved_count({ count: resolvedCount, total: conflicts.length })}</span>
      <div class="navigation">
        <button disabled={index === 0 || busy} onclick={() => (index -= 1)}>{m.common_previous()}</button>
        {#if index < conflicts.length - 1}
          <button disabled={!currentDraft.choice || busy} onclick={() => (index += 1)}>{m.conflict_next()}</button>
        {:else}
          <button class="merge" disabled={!canSubmit} onclick={submit}>
            {busy ? m.conflict_merging() : m.conflict_merge_branch()}
          </button>
        {/if}
      </div>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: rgb(17 24 39 / 0.6);
  }
  .dialog {
    width: min(920px, 100%);
    max-height: calc(100dvh - 2rem);
    overflow: auto;
    border-radius: 14px;
    background: white;
    box-shadow: 0 24px 70px rgb(0 0 0 / 0.3);
  }
  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.2rem;
  }
  header { border-bottom: 1px solid #e5e7eb; }
  footer { border-top: 1px solid #e5e7eb; }
  h2 { margin: 0.1rem 0; }
  .eyebrow,
  .anchor {
    margin: 0;
    color: #6b7280;
    font-size: 0.82rem;
  }
  .eyebrow {
    font-weight: 750;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .close {
    width: 2.4rem;
    height: 2.4rem;
    border: 0;
    border-radius: 999px;
    background: #f3f4f6;
    font-size: 1.5rem;
    cursor: pointer;
  }
  .versions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    padding: 1rem 1.2rem;
  }
  .versions article {
    min-width: 0;
    border: 1px solid #e5e7eb;
    border-radius: 9px;
    overflow: hidden;
  }
  .versions h3 {
    margin: 0;
    padding: 0.55rem 0.7rem;
    background: #f8fafc;
    font-size: 0.82rem;
  }
  pre {
    min-height: 4rem;
    margin: 0;
    padding: 0.7rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: 0.92rem/1.45 system-ui, sans-serif;
  }
  fieldset {
    margin: 0 1.2rem 1rem;
    padding: 0.9rem;
    border: 1px solid #d1d5db;
    border-radius: 10px;
  }
  legend { padding: 0 0.4rem; font-weight: 700; }
  .choices,
  .navigation {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  button {
    min-height: 2.4rem;
    padding: 0 0.75rem;
    border: 1px solid #cbd0d8;
    border-radius: 7px;
    background: white;
    color: #17191d;
    font: inherit;
    cursor: pointer;
  }
  button.selected {
    border-color: #7c3aed;
    background: #ede9fe;
    color: #5b21b6;
    box-shadow: 0 0 0 2px #c4b5fd;
  }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  .manual {
    display: grid;
    gap: 0.35rem;
    margin-top: 0.8rem;
  }
  .manual span { color: #4b5563; font-size: 0.82rem; font-weight: 700; }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    border: 1px solid #a78bfa;
    border-radius: 8px;
    padding: 0.65rem;
    font: inherit;
  }
  button.merge {
    border-color: #5b21b6;
    background: #5b21b6;
    color: white;
    font-weight: 700;
  }
  footer > span { color: #6b7280; font-size: 0.85rem; }

  @media (max-width: 700px) {
    .versions { grid-template-columns: 1fr; }
    footer { align-items: flex-start; flex-direction: column; }
    .navigation { width: 100%; }
  }
</style>
