<script lang="ts">
  import { PUBLIC_API_URL } from '$env/static/public';
  import { episodeName, statusLabel } from '$lib/catalog';
  import type { Episode } from '$lib/types';

  let { episodes, signedIn, limit }: { episodes: Episode[]; signedIn: boolean; limit?: number } = $props();
  let visible = $derived(limit ? episodes.slice(0, limit) : episodes);
</script>

{#if visible.length === 0}
  <p class="empty">No episodes submitted yet.</p>
{:else}
  <ol class="episodes">
    {#each visible as episode (episode.id)}
      <li>
        <div class="episode-number">{episode.number}</div>
        <div class="episode-copy">
          <strong>{episodeName(episode)}</strong>
          <span>{episode.sourceLanguage.toUpperCase()} → {episode.targetLanguage.toUpperCase()}</span>
        </div>
        <span class:published={episode.status === 'published'} class="status">
          {statusLabel(episode.status)}
        </span>
        <div class="episode-actions">
          {#if episode.status === 'published'}
            <a href={`${PUBLIC_API_URL}/episodes/${episode.id}/subtitle.ass`}>ASS</a>
            <a href={`${PUBLIC_API_URL}/episodes/${episode.id}/subtitle.srt`}>SRT</a>
          {:else if signedIn && ['ready_for_edit', 'in_review'].includes(episode.status)}
            <a class="edit" href={`/episodes/${episode.id}/edit`}>Open editor</a>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .episodes { display: grid; gap: 0.2rem; margin: 0; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: 2rem minmax(0, 1fr) auto auto; gap: 0.7rem; min-height: 3.35rem; padding: 0.45rem 0; align-items: center; border-top: 1px solid #ece9f0; }
  .episode-number { display: grid; width: 1.8rem; height: 1.8rem; place-items: center; border-radius: 0.5rem; background: #f1eef6; color: #5d526c; font: 800 0.72rem/1 system-ui, sans-serif; }
  .episode-copy { min-width: 0; }
  .episode-copy strong, .episode-copy span { display: block; }
  .episode-copy strong { overflow: hidden; color: #211d29; font-size: 0.86rem; text-overflow: ellipsis; white-space: nowrap; }
  .episode-copy span { margin-top: 0.12rem; color: #8a8492; font-size: 0.68rem; }
  .status { border-radius: 999px; background: #f3f0f6; padding: 0.25rem 0.5rem; color: #71697d; font-size: 0.66rem; font-weight: 800; white-space: nowrap; }
  .status.published { background: #e4f7ec; color: #167a46; }
  .episode-actions { display: flex; gap: 0.35rem; }
  .episode-actions a { border: 1px solid #ded8e8; border-radius: 0.42rem; padding: 0.28rem 0.42rem; color: #6d28d9; font-size: 0.65rem; font-weight: 850; text-decoration: none; }
  .episode-actions a.edit { border-color: #6d28d9; background: #6d28d9; color: white; }
  .empty { margin: 0; padding: 1rem 0; color: #8a8492; font-size: 0.85rem; }
  @media (max-width: 560px) { li { grid-template-columns: 2rem minmax(0, 1fr) auto; } .episode-actions { grid-column: 2 / -1; } }
</style>
