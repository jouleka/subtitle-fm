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
  import ConflictResolutionModal from '$lib/ConflictResolutionModal.svelte';
  import {
    createSubtitleBranch,
    fetchBranchDiff,
    mergeSubtitleBranch,
    rejectSubtitleBranch,
    type SubtitleBranch,
  } from '$lib/branch-api';
  import {
    threeWayTextDiff,
    type CueConflictResolution,
    type CueListDiffRow,
  } from '@subtitle-fm/shared';
  import type { PageData } from './$types';
  import { m } from '$lib/paraglide/messages';

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
  const initialBranches = untrack(() => [...data.branches]);
  const initialBranchBaseId = untrack(
    () => data.snapshots[data.snapshots.length - 1]?.id ?? '',
  );
  let branches = $state<SubtitleBranch[]>(initialBranches);
  let branchName = $state('');
  let branchBaseId = $state(initialBranchBaseId);
  let branchBusy = $state<string | null>(null);
  let resolutionBranch = $state<SubtitleBranch | null>(null);
  let resolutionConflicts = $state<CueListDiffRow[]>([]);
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
      if (comparison.diff.rows.length === 0) message = m.history_no_cues();
    } catch (cause) {
      comparison = null;
      message = m.history_comparison_failed({ error: (cause as Error).message });
    } finally {
      loading = false;
    }
  }

  async function createBranch() {
    if (!branchName.trim() || !branchBaseId) return;
    branchBusy = 'create';
    message = null;
    try {
      const created = await createSubtitleBranch(PUBLIC_API_URL, data.episode.id, {
        name: branchName.trim(),
        baseSnapshotId: branchBaseId,
      });
      branches = [created, ...branches];
      branchName = '';
      message = m.history_branch_created({ branch: created.name });
    } catch (cause) {
      message = m.history_branch_creation_failed({ error: (cause as Error).message });
    } finally {
      branchBusy = null;
    }
  }

  async function compareBranch(branch: SubtitleBranch) {
    branchBusy = branch.id;
    message = null;
    try {
      comparison = await fetchBranchDiff(PUBLIC_API_URL, data.episode.id, branch.id);
      message = m.history_comparing_branch({ branch: branch.name });
    } catch (cause) {
      comparison = null;
      message = m.history_branch_comparison_failed({ error: (cause as Error).message });
    } finally {
      branchBusy = null;
    }
  }

  function markBranchMerged(branch: SubtitleBranch) {
    branches = branches.map((item) =>
      item.id === branch.id ? { ...item, status: 'merged' as const } : item,
    );
    comparison = null;
    resolutionBranch = null;
    resolutionConflicts = [];
    message = m.history_branch_merged({ branch: branch.name });
  }

  async function prepareMerge(branch: SubtitleBranch) {
    branchBusy = branch.id;
    message = null;
    try {
      comparison = await fetchBranchDiff(PUBLIC_API_URL, data.episode.id, branch.id);
      const conflicts = comparison.diff.rows.filter((row) => row.conflict);
      if (conflicts.length > 0) {
        resolutionBranch = branch;
        resolutionConflicts = conflicts;
        message = m.history_resolve_conflicts({ count: conflicts.length, branch: branch.name });
      } else {
        await mergeSubtitleBranch(PUBLIC_API_URL, data.episode.id, branch.id, []);
        markBranchMerged(branch);
      }
    } catch (cause) {
      message = m.history_merge_preparation_failed({ error: (cause as Error).message });
    } finally {
      branchBusy = null;
    }
  }

  async function submitResolutions(resolutions: CueConflictResolution[]) {
    const branch = resolutionBranch;
    if (!branch) return;
    branchBusy = branch.id;
    message = null;
    try {
      await mergeSubtitleBranch(PUBLIC_API_URL, data.episode.id, branch.id, resolutions);
      markBranchMerged(branch);
    } catch (cause) {
      message = m.history_merge_stopped({ error: (cause as Error).message });
    } finally {
      branchBusy = null;
    }
  }

  async function rejectBranch(branch: SubtitleBranch) {
    if (!data.access.canMerge) return;
    if (!confirm(m.history_reject_confirm({ branch: branch.name }))) {
      return;
    }
    branchBusy = branch.id;
    message = null;
    try {
      const result = await rejectSubtitleBranch(PUBLIC_API_URL, data.episode.id, branch.id);
      branches = branches.map((item) => (item.id === branch.id ? result.branch : item));
      comparison = null;
      message = m.history_branch_rejected({
        branch: branch.name,
        penalty: result.reputationPenalty,
      });
    } catch (cause) {
      message = m.history_branch_rejection_failed({ error: (cause as Error).message });
    } finally {
      branchBusy = null;
    }
  }

  function closeResolution() {
    if (branchBusy !== null) return;
    resolutionBranch = null;
    resolutionConflicts = [];
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
  <title>{m.history_page_title()} — {data.episode.title ?? m.editor_episode_fallback({ number: data.episode.number })}</title>
</svelte:head>

<main class="history-page">
  <header>
    <div>
      <a class="back" href={`/episodes/${data.episode.id}/edit`}>{m.common_back_to_editor()}</a>
      <h1>{m.history_page_title()}</h1>
      <p>{m.history_intro()}</p>
    </div>
    <span class="episode-label">{data.episode.title ?? m.editor_episode_fallback({ number: data.episode.number })}</span>
  </header>

  <section class="branch-panel" aria-labelledby="branches-heading">
    <div class="branch-heading">
      <div>
        <h2 id="branches-heading">{m.history_branches()}</h2>
        <p>{m.history_branches_intro()}</p>
        <p class="access-summary">
          {m.history_role()} <strong>{data.access.showRole?.toUpperCase() ?? data.access.globalRole}</strong>
          · <strong>{data.access.reputation}</strong> {m.history_reputation()}
          {#if !data.access.canMerge}
            · {m.history_merge_requirement({ threshold: data.access.thresholds.merge })}
          {/if}
        </p>
      </div>
      {#if data.snapshots.length > 0}
        <div class="branch-create">
          <label>
            <span>{m.history_name()}</span>
            <input bind:value={branchName} placeholder="alternate-ed" pattern="[a-z0-9][a-z0-9._-]*" />
          </label>
          <label>
            <span>{m.history_fork_from()}</span>
            <select bind:value={branchBaseId}>
              {#each data.snapshots as snapshot (snapshot.id)}
                <option value={snapshot.id}>{snapshot.label}</option>
              {/each}
            </select>
          </label>
          <button disabled={!branchName.trim() || branchBusy !== null} onclick={createBranch}>
            {branchBusy === 'create' ? m.history_creating() : m.history_create_branch()}
          </button>
        </div>
      {/if}
    </div>
    {#if data.snapshots.length === 0}
      <p class="branch-empty">{m.history_milestone_needed()}</p>
    {:else if branches.length === 0}
      <p class="branch-empty">{m.history_no_branches()}</p>
    {:else}
      <div class="branch-list">
        {#each branches as branch (branch.id)}
          <article>
            <div>
              <strong>{branch.name}</strong>
              <span class="branch-status {branch.status}">{branch.status}</span>
              <small>{m.history_base_prefix({ label: data.snapshots.find((item) => item.id === branch.baseSnapshotId)?.label ?? m.history_milestone() })}</small>
            </div>
            <div class="branch-actions">
              {#if branch.status === 'open'}
                <a class="button-link" href={`/episodes/${data.episode.id}/edit?branch=${branch.id}`}>{m.common_edit()}</a>
                <button disabled={branchBusy !== null} onclick={() => compareBranch(branch)}>{m.common_compare()}</button>
                {#if data.access.canMerge}
                  <button class="merge-button" disabled={branchBusy !== null} onclick={() => prepareMerge(branch)}>
                    {branchBusy === branch.id ? m.common_working() : m.common_merge()}
                  </button>
                  <button class="reject-button" disabled={branchBusy !== null} onclick={() => rejectBranch(branch)}>
                    {m.common_reject()}
                  </button>
                {:else}
                  <span class="permission-note">{m.history_awaiting_reviewer()}</span>
                {/if}
              {:else}
                <button disabled={branchBusy !== null} onclick={() => compareBranch(branch)}>{m.history_view_diff()}</button>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  {#if data.snapshots.length < 3}
    <section class="empty-state">
      <h2>{m.history_three_required()}</h2>
      <p>{m.history_three_required_body()}</p>
      <p>{m.history_available({ count: data.snapshots.length })}</p>
    </section>
  {:else}
    <section class="controls" aria-label={m.history_snapshot_selection()}>
      <label>
        <span>{m.history_base()}</span>
        <select bind:value={baseId}>
          {#each data.snapshots as snapshot (snapshot.id)}
            <option value={snapshot.id}>{snapshot.label}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>{m.history_ours()}</span>
        <select bind:value={oursId}>
          {#each data.snapshots as snapshot (snapshot.id)}
            <option value={snapshot.id}>{snapshot.label}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>{m.history_theirs()}</span>
        <select bind:value={theirsId}>
          {#each data.snapshots as snapshot (snapshot.id)}
            <option value={snapshot.id}>{snapshot.label}</option>
          {/each}
        </select>
      </label>
      <button disabled={!canCompare || loading} onclick={compare}>
        {loading ? m.history_comparing() : m.history_compare_snapshots()}
      </button>
    </section>

    {#if !canCompare}
      <p class="selection-warning">{m.history_choose_three()}</p>
    {/if}
  {/if}

  {#if message}<p class="message">{message}</p>{/if}

  {#if comparison}
      <section class="summary" aria-label={m.history_diff_summary()}>
        <span class="added"><strong>{comparison.diff.summary.added}</strong> {m.history_added()}</span>
        <span class="removed"><strong>{comparison.diff.summary.removed}</strong> {m.history_removed()}</span>
        <span class="modified"><strong>{comparison.diff.summary.modified}</strong> {m.history_modified()}</span>
        <span><strong>{comparison.diff.summary.conflicts}</strong> {m.history_cue_conflicts()}</span>
        <span class="text-conflicts"><strong>{textConflictCount}</strong> {m.history_text_conflicts()}</span>
        <label class="unchanged-toggle">
          <input type="checkbox" bind:checked={showUnchanged} /> {m.history_show_unchanged()}
        </label>
      </section>

      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{m.history_status()}</th>
              <th>{m.history_base()} · {comparison.snapshots.base.label}</th>
              <th>{m.history_ours()} · {comparison.snapshots.ours.label}</th>
              <th>{m.history_theirs()} · {comparison.snapshots.theirs.label}</th>
            </tr>
          </thead>
          <tbody>
            {#each visibleRows as row (row.key)}
              {@const inlineDiff = textDiffFor(row)}
              <tr class:conflict={row.conflict} class:text-conflict={inlineDiff.conflicts.length > 0}>
                <th scope="row">
                  <span class="badge {row.kind}">{row.kind}</span>
                  {#if row.conflict}<span class="conflict-label">{m.history_cue_conflict()}</span>{/if}
                  {#if inlineDiff.conflicts.length > 0}
                    <span class="text-conflict-label">{m.history_text_conflict()}</span>
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
              <tr><td class="no-changes" colspan="4">{m.history_no_changes()}</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
  {/if}
  {#if resolutionBranch}
    <ConflictResolutionModal
      branchName={resolutionBranch.name}
      conflicts={resolutionConflicts}
      busy={branchBusy === resolutionBranch.id}
      onCancel={closeResolution}
      onResolve={submitResolutions}
    />
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
  .branch-panel,
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
  .branch-panel {
    margin-bottom: 1rem;
    padding: 1rem;
  }
  .branch-heading {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: end;
  }
  .branch-heading h2 {
    margin: 0 0 0.25rem;
  }
  .branch-heading p,
  .branch-empty {
    margin: 0;
    color: #646973;
  }
  .branch-heading .access-summary {
    margin-top: 0.35rem;
    color: #5b21b6;
    font-size: 0.82rem;
  }
  .branch-create {
    display: flex;
    gap: 0.55rem;
    align-items: end;
  }
  .branch-create label {
    display: grid;
    gap: 0.25rem;
  }
  .branch-create label span {
    color: #646973;
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
  }
  input {
    min-height: 2.45rem;
    box-sizing: border-box;
    border: 1px solid #cbd0d8;
    border-radius: 7px;
    padding: 0 0.65rem;
    font: inherit;
  }
  .branch-list {
    display: grid;
    gap: 0.55rem;
    margin-top: 0.9rem;
  }
  .branch-list article {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    padding: 0.65rem 0.75rem;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
  }
  .branch-list small {
    display: block;
    margin-top: 0.2rem;
    color: #737984;
  }
  .branch-status {
    margin-left: 0.4rem;
    padding: 0.12rem 0.4rem;
    border-radius: 999px;
    background: #dcfce7;
    color: #166534;
    font-size: 0.72rem;
  }
  .branch-status.merged { background: #e5e7eb; color: #4b5563; }
  .branch-status.rejected { background: #fee2e2; color: #991b1b; }
  .branch-actions {
    display: flex;
    gap: 0.4rem;
  }
  .branch-actions button,
  .button-link {
    min-height: 2.2rem;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.65rem;
    border-radius: 7px;
    font-size: 0.85rem;
    text-decoration: none;
  }
  .button-link {
    border: 1px solid #cbd0d8;
    color: #17191d;
    background: white;
  }
  .branch-actions .merge-button { background: #5b21b6; border-color: #5b21b6; }
  .branch-actions .reject-button { background: #991b1b; border-color: #991b1b; }
  .permission-note { align-self: center; color: #7c3aed; font-size: 0.78rem; }
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
    .branch-heading,
    .branch-list article { display: grid; }
    .branch-create { display: grid; grid-template-columns: 1fr; align-items: stretch; }
  }
</style>
