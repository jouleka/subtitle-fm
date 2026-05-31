<script lang="ts">
  import { PUBLIC_API_URL } from '$env/static/public';
  import type {
    GlossaryTerm,
    GlossaryTermKind,
    CreateGlossaryTerm,
    UpdateGlossaryTerm,
  } from '@subtitle-fm/shared';
  import { createTerm, updateTerm, deleteTerm, GlossaryApiError } from '$lib/glossary-api';
  import GlossaryTermModal from '$lib/GlossaryTermModal.svelte';

  let {
    terms,
    matchedIds,
    showId,
    onInsert,
    onChanged,
  }: {
    terms: GlossaryTerm[];
    matchedIds: Set<string>;
    showId: string;
    onInsert: (targetText: string) => void;
    onChanged: () => void | Promise<void>;
  } = $props();

  let modalOpen = $state(false);
  let modalMode = $state<'create' | 'edit'>('create');
  let modalInitial = $state<{ sourceText: string; targetText: string; kind: GlossaryTermKind; notes: string }>({
    sourceText: '',
    targetText: '',
    kind: 'term',
    notes: '',
  });
  let modalError = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let submitting = $state(false);
  let editingId = $state<string | null>(null);
  let pendingPrefill = '';

  // mousedown fires before the focused cue textarea blurs → its selection is still
  // live. (Mid-IME-composition the slice may include uncommitted preedit text — a
  // benign documented edge: it only prefills an editable modal field.)
  function capturePrefill() {
    const el = document.activeElement;
    pendingPrefill =
      el instanceof HTMLTextAreaElement && el.classList.contains('cue-text')
        ? el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)
        : '';
  }
  function openCreate() {
    modalMode = 'create';
    editingId = null;
    modalError = null;
    modalInitial = { sourceText: pendingPrefill, targetText: '', kind: 'term', notes: '' };
    modalOpen = true;
  }
  function openEdit(t: GlossaryTerm) {
    modalMode = 'edit';
    editingId = t.id;
    modalError = null;
    modalInitial = { sourceText: t.sourceText, targetText: t.targetText, kind: t.kind, notes: t.notes ?? '' };
    modalOpen = true;
  }
  async function submit(payload: CreateGlossaryTerm | UpdateGlossaryTerm) {
    submitting = true;
    modalError = null;
    try {
      if (modalMode === 'create') await createTerm(PUBLIC_API_URL, showId, payload as CreateGlossaryTerm);
      else await updateTerm(PUBLIC_API_URL, showId, editingId!, payload as UpdateGlossaryTerm);
      modalOpen = false;
      await onChanged();
    } catch (e) {
      const status = e instanceof GlossaryApiError ? e.status : 0;
      if (status === 404) {
        // Edit target vanished (deleted by another editor) — close + reconcile
        // rather than strand the user editing a ghost row.
        modalOpen = false;
        await onChanged();
      } else {
        modalError = e instanceof GlossaryApiError ? e.code : 'request_failed';
      }
    } finally {
      submitting = false;
    }
  }
  async function remove(t: GlossaryTerm) {
    if (!confirm(`Delete glossary term "${t.sourceText}"?`)) return;
    actionError = null;
    try {
      await deleteTerm(PUBLIC_API_URL, showId, t.id);
    } catch (e) {
      const status = e instanceof GlossaryApiError ? e.status : 0;
      // 404 = already gone — the refetch below reconciles silently. Anything else
      // (esp. 401 expired session) MUST surface; the GET refetch is ungated so it
      // would otherwise "succeed" and give zero signal the delete failed.
      if (status !== 404) {
        actionError =
          status === 401
            ? 'Your session expired — reload to continue.'
            : 'Could not delete that term. Please try again.';
      }
    }
    await onChanged();
  }
</script>

<div class="glossary">
  <div class="glossary-head">
    <h2 class="glossary-title">Glossary</h2>
    <button class="add-btn" type="button" onmousedown={capturePrefill} onclick={openCreate}>+ Add</button>
  </div>
  {#if actionError}<p class="action-error" role="alert">{actionError}</p>{/if}
  {#if terms.length === 0}
    <p class="empty">No glossary terms for this show yet.</p>
  {:else}
    <ul class="terms">
      {#each terms as term (term.id)}
        <li class:matched={matchedIds.has(term.id)}>
          <button
            class="term"
            type="button"
            title={term.notes || undefined}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => onInsert(term.targetText)}
          >
            <span class="src">{term.sourceText}</span>
            <span class="arrow">→</span>
            <span class="tgt">{term.targetText}</span>
            <span class="kind">{term.kind}</span>
          </button>
          <span class="row-actions">
            {#if matchedIds.has(term.id)}<span class="match" title="Appears in the focused cue">in cue</span>{/if}
            <button class="icon" type="button" aria-label={`Edit ${term.sourceText}`} onclick={() => openEdit(term)}>✎</button>
            <button class="icon" type="button" aria-label={`Delete ${term.sourceText}`} onclick={() => remove(term)}>🗑</button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if modalOpen}
  <GlossaryTermModal
    mode={modalMode}
    initial={modalInitial}
    error={modalError}
    {submitting}
    onSubmit={submit}
    onClose={() => (modalOpen = false)}
  />
{/if}

<style>
  .glossary {
    padding: 0.5rem;
  }
  .glossary-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .glossary-title {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #666;
    margin: 0;
  }
  .add-btn {
    font: inherit;
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    cursor: pointer;
    border: 1px solid #c7d2fe;
    border-radius: 4px;
    background: #eef2ff;
    color: #3730a3;
  }
  .action-error {
    color: #b91c1c;
    font-size: 0.8rem;
    margin: 0 0 0.5rem;
  }
  .terms {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .terms li {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    border: 1px solid #eee;
    border-radius: 4px;
  }
  .terms li.matched {
    border-color: #6ee7b7;
    background: #ecfdf5;
  }
  .term {
    display: flex;
    gap: 0.4rem;
    align-items: baseline;
    flex: 1;
    min-width: 0;
    text-align: left;
    background: none;
    border: none;
    padding: 0.3rem 0.4rem;
    cursor: pointer;
    font: inherit;
  }
  .term:hover {
    background: #f5f7ff;
  }
  .src {
    font-weight: 600;
  }
  .arrow {
    color: #999;
  }
  .tgt {
    flex: 1;
  }
  .kind {
    font-size: 0.65rem;
    color: #3730a3;
    background: #eef2ff;
    border-radius: 999px;
    padding: 0 0.4rem;
  }
  .row-actions {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding-right: 0.3rem;
  }
  .match {
    font-size: 0.6rem;
    color: #065f46;
    background: #d1fae5;
    border-radius: 999px;
    padding: 0 0.4rem;
    white-space: nowrap;
  }
  .icon {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0.1rem 0.2rem;
    line-height: 1;
  }
  .icon:hover {
    background: #f3f4f6;
    border-radius: 3px;
  }
  .empty {
    color: #888;
    font-style: italic;
    font-size: 0.85rem;
  }
</style>
