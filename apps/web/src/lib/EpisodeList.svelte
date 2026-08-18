<script lang="ts">
  import { PUBLIC_API_URL } from '$env/static/public';
  import { episodeName, statusLabel } from '$lib/catalog';
  import type { Episode } from '$lib/types';

  let { episodes, signedIn, limit }: { episodes: Episode[]; signedIn: boolean; limit?: number } = $props();
  let visible = $derived(limit ? episodes.slice(0, limit) : episodes);
</script>

{#if visible.length === 0}
  <div class="empty"><span>00</span><p>No episodes submitted yet.</p></div>
{:else}
  <ol class="episodes">
    {#each visible as episode (episode.id)}
      <li>
        <div class="episode-number">{String(episode.number).padStart(2, '0')}</div>
        <div class="episode-copy">
          <strong>{episodeName(episode)}</strong>
          <span>{episode.sourceLanguage.toUpperCase()} → {episode.targetLanguage.toUpperCase()}</span>
        </div>
        <span class:published={episode.status === 'published'} class="status"><i></i>{statusLabel(episode.status)}</span>
        <div class="episode-actions">
          {#if episode.status === 'published'}
            <a href={`${PUBLIC_API_URL}/episodes/${episode.id}/subtitle.ass`}>ASS</a>
            <a href={`${PUBLIC_API_URL}/episodes/${episode.id}/subtitle.srt`}>SRT</a>
            <a href={`${PUBLIC_API_URL}/episodes/${episode.id}/subtitle.vtt`}>VTT</a>
          {:else if signedIn && ['ready_for_edit', 'in_review'].includes(episode.status)}
            <a class="edit" href={`/episodes/${episode.id}/edit`}>Open editor <span>→</span></a>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .episodes { display: grid; margin: 0; border-top: 1px solid #b9bbb5; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: 3.2rem minmax(0, 1fr) auto auto; gap: 1rem; min-height: 5rem; align-items: center; border-bottom: 1px solid #c7c8c2; }
  .episode-number { color: #bd654d; font: 0.58rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .episode-copy { min-width: 0; }
  .episode-copy strong, .episode-copy span { display: block; }
  .episode-copy strong { overflow: hidden; color: #24292a; font-size: 0.78rem; text-overflow: ellipsis; white-space: nowrap; }
  .episode-copy span { margin-top: 0.18rem; color: #8a8f8e; font: 0.52rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .status { display: flex; align-items: center; gap: 0.35rem; color: #6f7675; font-size: 0.58rem; font-weight: 750; white-space: nowrap; }
  .status i { width: 0.35rem; height: 0.35rem; border-radius: 50%; background: #b2895b; }
  .status.published { color: #4d6f5b; }
  .status.published i { background: #668971; }
  .episode-actions { display: flex; justify-content: flex-end; gap: 0.35rem; }
  .episode-actions a { border: 1px solid #afb1ab; border-radius: 0.15rem; padding: 0.35rem 0.45rem; color: #4f5756; font: 750 0.52rem ui-monospace, SFMono-Regular, Menlo, monospace; text-decoration: none; }
  .episode-actions a:hover { border-color: #a35a45; color: #a35a45; }
  .episode-actions a.edit { display: inline-flex; gap: 1rem; border-color: #252a2b; background: #252a2b; padding-inline: 0.65rem; color: #f4f2ec; font-family: inherit; }
  .empty { display: grid; grid-template-columns: 3.2rem 1fr; min-height: 5rem; align-items: center; border-top: 1px solid #b9bbb5; border-bottom: 1px solid #c7c8c2; }
  .empty span { color: #bd654d; font: 0.58rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .empty p { margin: 0; color: #858a89; font-size: 0.72rem; }

  @media (max-width: 620px) {
    li { grid-template-columns: 2rem minmax(0, 1fr); gap: 0.35rem 0.7rem; padding: 0.75rem 0; }
    .status { grid-column: 2; }
    .episode-actions { grid-column: 2; justify-content: flex-start; margin-top: 0.2rem; }
    .empty { grid-template-columns: 2rem 1fr; }
  }
</style>
