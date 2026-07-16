<script lang="ts">
  import { PUBLIC_API_URL } from '$env/static/public';
  import { untrack } from 'svelte';
  import { auditValue, fetchEpisodeAudit, type CueAuditEvent } from '$lib/audit-api';
  import type { PageData } from './$types';
  import { m } from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();
  const initial = untrack(() => ({
    events: [...data.events],
    hasMore: data.hasMore,
    nextBefore: data.nextBefore,
    nextBeforeId: data.nextBeforeId,
  }));
  let events = $state<CueAuditEvent[]>(initial.events);
  let hasMore = $state(initial.hasMore);
  let nextBefore = $state(initial.nextBefore);
  let nextBeforeId = $state(initial.nextBeforeId);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  async function loadMore() {
    if (!hasMore || !nextBefore || !nextBeforeId || loading) return;
    loading = true;
    loadError = null;
    try {
      const page = await fetchEpisodeAudit(PUBLIC_API_URL, data.episode.id, {
        limit: 50,
        before: nextBefore,
        beforeId: nextBeforeId,
      });
      events = [...events, ...page.events];
      hasMore = page.hasMore;
      nextBefore = page.nextBefore;
      nextBeforeId = page.nextBeforeId;
    } catch (cause) {
      loadError = (cause as Error).message;
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>{m.audit_page_title()} — {data.episode.title ?? m.editor_episode_fallback({ number: data.episode.number })}</title>
</svelte:head>

<main>
  <header>
    <div>
      <a href={`/episodes/${data.episode.id}/edit`}>{m.common_back_to_editor()}</a>
      <h1>{m.audit_heading()}</h1>
      <p>{data.episode.title ?? m.editor_episode_fallback({ number: data.episode.number })} · {m.audit_attributed_changes()}</p>
    </div>
    <span>{m.audit_loaded({ count: events.length })}</span>
  </header>

  {#if events.length === 0}
    <section class="empty">
      <h2>{m.audit_empty_heading()}</h2>
      <p>{m.audit_empty_body()}</p>
    </section>
  {:else}
    <ol class="timeline">
      {#each events as event (event.id)}
        <li>
          <span class="marker"></span>
          <article>
            <div class="event-heading">
              <strong>{event.userHandle ?? m.cue_history_deleted_user()}</strong>
              <span>{m.audit_changed()} <b>{event.fieldChanged}</b></span>
              <time datetime={event.ts}>{new Date(event.ts).toLocaleString()}</time>
            </div>
            <code>{m.audit_cue({ id: event.cueId.slice(0, 8) })}</code>
            <div class="change">
              <span class="old">{auditValue(event.oldValue)}</span>
              <span aria-hidden="true">→</span>
              <span class="new">{auditValue(event.newValue)}</span>
            </div>
          </article>
        </li>
      {/each}
    </ol>
    {#if hasMore}
      <button class="load-more" disabled={loading} onclick={loadMore}>
        {loading ? m.cue_history_loading() : m.audit_load_older()}
      </button>
    {/if}
    {#if loadError}<p class="error">{m.audit_load_error({ error: loadError })}</p>{/if}
  {/if}
</main>

<style>
  :global(body) { margin: 0; background: #f6f7f9; color: #17191d; font-family: system-ui, sans-serif; }
  main { width: min(900px, calc(100% - 2rem)); margin: 0 auto; padding: 1.5rem 0 3rem; }
  header { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
  header a { color: #5b21b6; text-decoration: none; }
  h1 { margin: 0.35rem 0 0.2rem; }
  header p { margin: 0; color: #68707b; }
  header > span { padding: 0.35rem 0.6rem; border-radius: 999px; background: #ede9fe; color: #5b21b6; font-size: 0.8rem; }
  .timeline { position: relative; display: grid; gap: 0.7rem; margin: 1.5rem 0; padding: 0; list-style: none; }
  .timeline::before { position: absolute; inset: 0 auto 0 0.42rem; width: 2px; background: #ddd6fe; content: ''; }
  .timeline li { position: relative; display: grid; grid-template-columns: 1rem 1fr; gap: 0.65rem; }
  .marker { z-index: 1; width: 0.8rem; height: 0.8rem; margin-top: 1rem; border: 2px solid #7c3aed; border-radius: 999px; background: white; }
  article, .empty { padding: 0.9rem 1rem; border: 1px solid #e0e3e8; border-radius: 9px; background: white; }
  .event-heading { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: baseline; }
  time { margin-left: auto; color: #818792; font-size: 0.75rem; }
  code { display: block; margin: 0.25rem 0 0.55rem; color: #6b7280; font-size: 0.72rem; }
  .change { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 0.55rem; align-items: start; }
  .change span { min-width: 0; overflow-wrap: anywhere; padding: 0.4rem; border-radius: 5px; font-size: 0.82rem; }
  .change .old { background: #fee2e2; color: #991b1b; }
  .change .new { background: #dcfce7; color: #166534; }
  .load-more { display: block; margin: 1rem auto; padding: 0.55rem 0.9rem; border: 0; border-radius: 7px; background: #5b21b6; color: white; font: inherit; font-weight: 700; cursor: pointer; }
  .load-more:disabled { opacity: 0.55; }
  .error { color: #b91c1c; text-align: center; }
  .empty { margin-top: 1.5rem; text-align: center; }
  @media (max-width: 600px) { .event-heading { display: grid; } time { margin-left: 0; } .change { grid-template-columns: 1fr; } }
</style>
