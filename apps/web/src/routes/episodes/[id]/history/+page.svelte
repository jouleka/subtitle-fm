<script lang="ts">
  import { untrack } from 'svelte';
  import { PUBLIC_API_URL } from '$env/static/public';
  import { formatMs } from '$lib/format';
  import {
    fetchSnapshotDiff,
    type SnapshotCompareResponse,
    type SnapshotMeta,
  } from '$lib/snapshot-diff-api';
  import InlineTextDiff from '$lib/InlineTextDiff.svelte';
  import { threeWayTextDiff, type CueListDiffRow } from '@subtitle-fm/shared';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function defaultSelection(snapshots: SnapshotMeta[]) {
    const newest = snapshots[0];
    const oldest = snapshots[snapshots.length - 1];
    const middle = snapshots.find(
      (snapshot) => snapshot.id !== newest?.id && snapshot.id !== oldest?.id,
    );
    return { base: oldest?.id ?? '', ours: middle?.id ?? '', theirs: newest?.id ?? '' };
  }

  const initialSelection = untrack(() => defaultSelection(data.snapshots));
  let baseId = $state(initialSelection.base);
  let oursId = $state(initialSelection.ours);
  let theirsId = $state(initialSelection.theirs);
  let comparison = $state<SnapshotCompareResponse | null>(null);
  let loading = $state(false);
  let message = $state<string | null>(null);
  let showUnchanged = $state(false);
  const canCompare = $derived(
    Boolean(baseId && oursId && theirsId && new Set([baseId, oursId, theirsId]).size === 3),
  );
  const visibleRows = $derived(
    comparison?.diff.rows.filter((row) => showUnchanged || row.kind !== 'unchanged') ?? [],
  );
  const textConflictCount = $derived(
    comparison?.diff.rows.filter((row) => textDiffFor(row).conflicts.length > 0).length ?? 0,
  );

  async function compare() {
    if (!canCompare) return;
    loading = true;
    message = null;
    try {
      comparison = await fetchSnapshotDiff(PUBLIC_API_URL, data.episode.id, {
        base: baseId,
        ours: oursId,
        theirs: theirsId,
      });
      if (comparison.diff.rows.length === 0) message = 'These snapshots contain no cues.';
    } catch (cause) {
      comparison = null;
      message = `Comparison failed: ${(cause as Error).message}`;
    } finally {
      loading = false;
    }
  }

  function cueText(row: CueListDiffRow, side: 'base' | 'ours' | 'theirs'): string {
    return row[side]?.text ?? '—';
  }

  function cueTime(row: CueListDiffRow, side: 'base' | 'ours' | 'theirs'): string {
    const cue = row[side];
    return cue ? `${formatMs(cue.startMs)} → ${formatMs(cue.endMs)}` : '';
  }

  function textDiffFor(row: CueListDiffRow) {
    return threeWayTextDiff(row.base?.text ?? '', row.ours?.text ?? '', row.theirs?.text ?? '');
  }
</script>

<svelte:head>
  <title>Snapshot history — {data.episode.title ?? `Episode ${data.episode.number}`}</title>
</svelte:head>

<main class="history-page">
  <header>
    <div>
      <a class="back" href={`/episodes/${data.episode.id}/edit`}>← Back to editor</a>
      <h1>Snapshot history</h1>
      <p>Compare cue-list changes across a base and two milestones.</p>
    </div>
    <span class="episode-label">{data.episode.title ?? `Episode ${data.episode.number}`}</span>
  </header>

  {#if data.snapshots.length < 3}
    <section class="empty-state">
      <h2>Three milestones required</h2>
      <p>Create at least three named snapshots in the editor workflow before comparing branches.</p>
      <p><strong>{data.snapshots.length}</strong> available now.</p>
    </section>
  {:else}
    <section class="controls" aria-label="Snapshot selection">
      <label>
        <span>Base</span>
        <select bind:value={baseId}>
          {#each data.snapshots as snapshot (snapshot.id)}
            <option value={snapshot.id}>{snapshot.label}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Ours</span>
        <select bind:value={oursId}>
          {#each data.snapshots as snapshot (snapshot.id)}
            <option value={snapshot.id}>{snapshot.label}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>Theirs</span>
        <select bind:value={theirsId}>
          {#each data.snapshots as snapshot (snapshot.id)}
            <option value={snapshot.id}>{snapshot.label}</option>
          {/each}
        </select>
      </label>
      <button disabled={!canCompare || loading} onclick={compare}>
        {loading ? 'Comparing…' : 'Compare snapshots'}
      </button>
    </section>

    {#if !canCompare}
      <p class="selection-warning">Choose three different snapshots.</p>
    {/if}
    {#if message}<p class="message">{message}</p>{/if}

    {#if comparison}
      <section class="summary" aria-label="Diff summary">
        <span class="added"><strong>{comparison.diff.summary.added}</strong> added</span>
        <span class="removed"><strong>{comparison.diff.summary.removed}</strong> removed</span>
        <span class="modified"><strong>{comparison.diff.summary.modified}</strong> modified</span>
        <span><strong>{comparison.diff.summary.conflicts}</strong> cue conflicts</span>
        <span class="text-conflicts"><strong>{textConflictCount}</strong> text conflicts</span>
        <label class="unchanged-toggle">
          <input type="checkbox" bind:checked={showUnchanged} /> Show unchanged
        </label>
      </section>

      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Base · {comparison.snapshots.base.label}</th>
              <th>Ours · {comparison.snapshots.ours.label}</th>
              <th>Theirs · {comparison.snapshots.theirs.label}</th>
            </tr>
          </thead>
          <tbody>
            {#each visibleRows as row (row.key)}
              {@const inlineDiff = textDiffFor(row)}
              <tr class:conflict={row.conflict} class:text-conflict={inlineDiff.conflicts.length > 0}>
                <th scope="row">
                  <span class="badge {row.kind}">{row.kind}</span>
                  {#if row.conflict}<span class="conflict-label">cue conflict</span>{/if}
                  {#if inlineDiff.conflicts.length > 0}
                    <span class="text-conflict-label">text conflict</span>
                  {/if}
                  <small>@ {formatMs(row.anchorMs)}</small>
                </th>
                {#each ['base', 'ours', 'theirs'] as side}
                  <td class:missing={!row[side as 'base' | 'ours' | 'theirs']}>
                    <small>{cueTime(row, side as 'base' | 'ours' | 'theirs')}</small>
                    {#if side === 'base' || !row[side as 'base' | 'ours' | 'theirs']}
                      <div>{cueText(row, side as 'base' | 'ours' | 'theirs')}</div>
                    {:else if side === 'ours'}
                      <InlineTextDiff segments={inlineDiff.ours} />
                    {:else}
                      <InlineTextDiff segments={inlineDiff.theirs} />
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
            {#if visibleRows.length === 0}
              <tr><td class="no-changes" colspan="4">No changed cues in this comparison.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f5f6f8;
    color: #17191d;
    font-family: system-ui, sans-serif;
  }
  .history-page {
    width: min(1500px, calc(100% - 2rem));
    margin: 0 auto;
    padding: 1.5rem 0 3rem;
  }
  header {
    display: flex;
    justify-content: space-between;
    gap: 2rem;
    align-items: flex-start;
    margin-bottom: 1.25rem;
  }
  h1 {
    margin: 0.35rem 0 0.2rem;
    font-size: clamp(1.7rem, 3vw, 2.4rem);
  }
  header p {
    margin: 0;
    color: #646973;
  }
  .back {
    color: #4b5563;
    text-decoration: none;
    font-size: 0.9rem;
  }
  .episode-label {
    padding: 0.45rem 0.7rem;
    border-radius: 999px;
    background: #e8ebf0;
    font-size: 0.85rem;
  }
  .controls,
  .summary,
  .empty-state,
  .table-scroll {
    background: white;
    border: 1px solid #dfe2e7;
    border-radius: 10px;
  }
  .controls {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
    gap: 0.75rem;
    padding: 1rem;
    align-items: end;
  }
  .controls label {
    display: grid;
    gap: 0.35rem;
  }
  .controls label span {
    color: #646973;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  select,
  button {
    min-height: 2.6rem;
    border: 1px solid #cbd0d8;
    border-radius: 7px;
    background: white;
    padding: 0 0.75rem;
    font: inherit;
  }
  button {
    background: #17191d;
    border-color: #17191d;
    color: white;
    cursor: pointer;
    font-weight: 650;
  }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .selection-warning,
  .message {
    color: #a34814;
    margin: 0.65rem 0 0;
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
    margin: 1rem 0;
    padding: 0.75rem 1rem;
  }
  .summary > span {
    padding: 0.25rem 0.55rem;
    border-radius: 999px;
    background: #f1f3f5;
    font-size: 0.85rem;
  }
  .summary .added { background: #dcfce7; color: #166534; }
  .summary .removed { background: #fee2e2; color: #991b1b; }
  .summary .modified { background: #fef3c7; color: #92400e; }
  .summary .text-conflicts { background: #ede9fe; color: #6d28d9; }
  .unchanged-toggle {
    margin-left: auto;
    font-size: 0.85rem;
  }
  .table-scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    min-width: 920px;
  }
  th,
  td {
    border-bottom: 1px solid #e5e7eb;
    border-right: 1px solid #eef0f3;
    padding: 0.8rem;
    text-align: left;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  thead th {
    position: sticky;
    top: 0;
    background: #f8f9fb;
    color: #4b5563;
    font-size: 0.8rem;
  }
  thead th:first-child,
  tbody th { width: 8.5rem; }
  tbody th {
    font-weight: 500;
  }
  td small,
  tbody th small {
    display: block;
    color: #7a808b;
    font-family: ui-monospace, monospace;
    margin-bottom: 0.35rem;
  }
  .badge,
  .conflict-label,
  .text-conflict-label {
    display: inline-block;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 750;
  }
  .badge.added { background: #dcfce7; color: #166534; }
  .badge.removed { background: #fee2e2; color: #991b1b; }
  .badge.modified { background: #fef3c7; color: #92400e; }
  .badge.unchanged { background: #e5e7eb; color: #4b5563; }
  .conflict-label { background: #ede9fe; color: #6d28d9; margin-left: 0.25rem; }
  .text-conflict-label {
    display: block;
    width: fit-content;
    margin-top: 0.3rem;
    background: #7c3aed;
    color: white;
  }
  tr.conflict { box-shadow: inset 4px 0 #7c3aed; }
  tr.text-conflict { background: #fdfbff; }
  td.missing { color: #a0a5ad; background: #fafafa; }
  .empty-state { padding: 2rem; text-align: center; }
  .empty-state h2 { margin-top: 0; }
  .no-changes { text-align: center; color: #737984; padding: 2rem; }

  @media (max-width: 1000px) {
    .controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .controls button { grid-column: 1 / -1; }
  }

  @media (max-width: 640px) {
    .controls { grid-template-columns: 1fr; }
    .controls button { grid-column: auto; }
    header { display: block; }
    .episode-label { display: inline-block; margin-top: 0.8rem; }
  }
</style>
