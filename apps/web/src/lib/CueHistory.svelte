<script lang="ts">
  import { PUBLIC_API_URL } from '$env/static/public';
  import { auditValue, fetchCueAudit, type CueAuditEvent } from '$lib/audit-api';

  let { episodeId, cueId }: { episodeId: string; cueId: string } = $props();
  let open = $state(false);
  let loaded = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let events = $state<CueAuditEvent[]>([]);

  async function toggle() {
    open = !open;
    if (!open || loaded || loading) return;
    loading = true;
    error = null;
    try {
      events = await fetchCueAudit(PUBLIC_API_URL, episodeId, cueId);
      loaded = true;
    } catch (cause) {
      error = (cause as Error).message;
    } finally {
      loading = false;
    }
  }
</script>

<span class="history-wrap">
  <button type="button" class="history-button" aria-expanded={open} onclick={toggle}>History</button>
  {#if open}
    <span class="history-tooltip" role="tooltip">
      <strong>Last 5 changes</strong>
      {#if loading}
        <span>Loading…</span>
      {:else if error}
        <span class="error">{error}</span>
      {:else if events.length === 0}
        <span>No recorded changes.</span>
      {:else}
        <ol>
          {#each events as event (event.id)}
            <li>
              <span><b>{event.userHandle ?? 'Deleted user'}</b> · {event.fieldChanged}</span>
              <small>{auditValue(event.oldValue)} → {auditValue(event.newValue)}</small>
              <time datetime={event.ts}>{new Date(event.ts).toLocaleString()}</time>
            </li>
          {/each}
        </ol>
      {/if}
    </span>
  {/if}
</span>

<style>
  .history-wrap { position: relative; align-self: center; }
  .history-button {
    border: 1px solid #d1d5db;
    border-radius: 5px;
    background: white;
    padding: 0.2rem 0.4rem;
    color: #5b21b6;
    font: 700 0.68rem system-ui, sans-serif;
    cursor: pointer;
  }
  .history-tooltip {
    position: absolute;
    z-index: 30;
    top: calc(100% + 0.35rem);
    right: 0;
    display: grid;
    gap: 0.45rem;
    width: min(24rem, 80vw);
    padding: 0.7rem;
    border: 1px solid #d8dbe2;
    border-radius: 8px;
    background: white;
    color: #20232a;
    box-shadow: 0 12px 30px rgb(0 0 0 / 0.18);
    font: 0.78rem/1.35 system-ui, sans-serif;
  }
  ol { display: grid; gap: 0.5rem; margin: 0; padding-left: 1.2rem; }
  li span, li small, time { display: block; }
  li small { overflow-wrap: anywhere; color: #4b5563; }
  time { color: #8a9099; font-size: 0.68rem; }
  .error { color: #b91c1c; }
</style>
