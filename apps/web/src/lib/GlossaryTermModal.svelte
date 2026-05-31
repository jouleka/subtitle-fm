<script lang="ts">
  import { GlossaryTermKind } from '@subtitle-fm/shared';
  import type { CreateGlossaryTerm, UpdateGlossaryTerm } from '@subtitle-fm/shared';
  import { buildTermPayload, type TermFormFields } from '$lib/glossary-form';

  let {
    mode,
    initial,
    error,
    submitting,
    onSubmit,
    onClose,
  }: {
    mode: 'create' | 'edit';
    initial: TermFormFields;
    error: string | null;
    submitting: boolean;
    onSubmit: (payload: CreateGlossaryTerm | UpdateGlossaryTerm) => void;
    onClose: () => void;
  } = $props();

  let sourceText = $state(initial.sourceText);
  let targetText = $state(initial.targetText);
  let kind = $state<GlossaryTermKind>(initial.kind);
  let notes = $state(initial.notes);
  let firstFieldEl: HTMLInputElement | undefined = $state();

  // Create needs a source + target; edit only target (source is read-only).
  const valid = $derived(
    mode === 'create'
      ? sourceText.trim().length > 0 && targetText.trim().length > 0
      : targetText.trim().length > 0,
  );

  $effect(() => {
    firstFieldEl?.focus();
  });

  function friendlyError(code: string): string {
    if (code === 'duplicate_source') return 'A term with this source already exists.';
    if (code === 'unauthorized') return 'Your session expired — reload to continue.';
    return 'Something went wrong. Please try again.';
  }

  function submit(e: Event) {
    e.preventDefault();
    if (!valid || submitting) return;
    const payload =
      mode === 'create'
        ? buildTermPayload('create', { sourceText, targetText, kind, notes })
        : buildTermPayload('edit', { sourceText, targetText, kind, notes });
    onSubmit(payload);
  }

  // Only close when the click is on the backdrop itself, not a bubbled click from
  // a child (e.g. a drag that started in a field and released over the backdrop).
  function onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="backdrop" onclick={onBackdrop} role="presentation">
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label={mode === 'create' ? 'Add glossary term' : 'Edit glossary term'}
  >
    <form onsubmit={submit}>
      <label>
        <span>Source</span>
        {#if mode === 'create'}
          <input bind:this={firstFieldEl} bind:value={sourceText} type="text" />
        {:else}
          <input value={initial.sourceText} type="text" readonly />
        {/if}
      </label>
      <label>
        <span>Target</span>
        {#if mode === 'create'}
          <input bind:value={targetText} type="text" />
        {:else}
          <input bind:this={firstFieldEl} bind:value={targetText} type="text" />
        {/if}
      </label>
      <label>
        <span>Kind</span>
        <select bind:value={kind}>
          {#each GlossaryTermKind.options as k}
            <option value={k}>{k}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Notes</span>
        <textarea bind:value={notes} rows="2"></textarea>
      </label>
      {#if error}<p class="error" role="alert">{friendlyError(error)}</p>{/if}
      <div class="actions">
        <button type="button" onclick={onClose} disabled={submitting}>Cancel</button>
        <button type="submit" disabled={!valid || submitting}>{submitting ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .modal {
    background: white;
    border-radius: 8px;
    padding: 1rem;
    width: min(420px, 92vw);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.8rem;
    color: #444;
  }
  input,
  select,
  textarea {
    font: inherit;
    padding: 0.3rem 0.4rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
  input[readonly] {
    background: #f3f4f6;
    color: #666;
  }
  .error {
    color: #b91c1c;
    font-size: 0.8rem;
    margin: 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.3rem;
  }
  .actions button {
    padding: 0.35rem 0.9rem;
    cursor: pointer;
  }
  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
