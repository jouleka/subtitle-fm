<script lang="ts">
  import EpisodeList from '$lib/EpisodeList.svelte';
  import SiteHeader from '$lib/SiteHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let user = $derived(data.session?.user ?? null);
</script>

<svelte:head>
  <title>{data.show.title} subtitles — Subtitle.fm</title>
  <meta name="description" content={data.show.description ?? `Community-polished subtitles for ${data.show.title}.`} />
  <meta property="og:title" content={`${data.show.title} subtitles — Subtitle.fm`} />
  <meta property="og:description" content={data.show.description ?? `Browse and contribute subtitles for ${data.show.title}.`} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={data.canonical} />
  {#if data.show.coverUrl}<meta property="og:image" content={data.show.coverUrl} />{/if}
  <link rel="canonical" href={data.canonical} />
</svelte:head>

<SiteHeader user={user} />
<main>
  <a class="back" href="/">← All shows</a>
  <section class="show-hero">
    <div class="cover">
      {#if data.show.coverUrl}<img src={data.show.coverUrl} alt={`${data.show.title} cover`} />{:else}<span>{data.show.title.slice(0, 1)}</span>{/if}
    </div>
    <div class="show-copy">
      <span class="eyebrow">Community subtitle project</span>
      <h1>{data.show.title}</h1>
      <p>{data.show.description ?? 'A community subtitle project open for faithful translation, careful timing, and review.'}</p>
      <div class="metadata">
        <span>{data.show.episodes.length} episode{data.show.episodes.length === 1 ? '' : 's'}</span>
        <span>{data.show.episodes.filter((episode) => episode.status === 'published').length} published</span>
        <span>{data.show.episodes.filter((episode) => ['ready_for_edit', 'in_review'].includes(episode.status)).length} open for editing</span>
      </div>
      <a class="submit-link" href={`/?show=${encodeURIComponent(data.show.id)}#submit`}>Submit an episode →</a>
    </div>
  </section>

  <section class="episode-panel">
    <header><div><span class="eyebrow">Release board</span><h2>Episodes</h2></div><p>Published downloads are public. Sign in to open episodes ready for community editing.</p></header>
    <EpisodeList episodes={data.show.episodes} signedIn={Boolean(user)} />
  </section>
</main>
<footer><a href="/">Subtitle.fm</a><span>Community-polished subtitles.</span><a href="/sitemap.xml">Sitemap</a></footer>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #fbfafc; color: #1d1823; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  main, footer { width: min(1040px, calc(100% - 2rem)); margin: 0 auto; }
  .back { display: inline-block; margin: 2.5rem 0 1.5rem; color: #746d7b; font-size: 0.78rem; font-weight: 800; text-decoration: none; }
  .show-hero { display: grid; grid-template-columns: 15rem minmax(0, 1fr); gap: clamp(2rem, 6vw, 5rem); align-items: center; }
  .cover { display: grid; aspect-ratio: 2 / 3; overflow: hidden; place-items: center; border-radius: 1rem; background: linear-gradient(145deg, #ddd0f3, #6b5681); color: white; box-shadow: 0 25px 55px rgb(51 37 66 / 0.2); }
  .cover img { width: 100%; height: 100%; object-fit: cover; }
  .cover span { font: 800 7rem/1 Georgia, serif; }
  .eyebrow { color: #7c3aed; font-size: 0.7rem; font-weight: 900; letter-spacing: 0.14em; text-transform: uppercase; }
  h1 { margin: 0.55rem 0 1rem; font: 850 clamp(3rem, 7vw, 5.4rem)/0.95 Georgia, serif; letter-spacing: -0.055em; }
  .show-copy > p { max-width: 620px; color: #6f6876; font-size: 1rem; line-height: 1.75; }
  .metadata { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1.4rem 0; }
  .metadata span { border-radius: 999px; background: #eee9f4; padding: 0.35rem 0.65rem; color: #605568; font-size: 0.68rem; font-weight: 800; }
  .submit-link { display: inline-block; border-radius: 999px; background: #6d28d9; padding: 0.75rem 1rem; color: white; font-size: 0.8rem; font-weight: 850; text-decoration: none; }
  .episode-panel { margin: 5rem 0; border: 1px solid #e2dde6; border-radius: 1rem; background: white; padding: clamp(1rem, 4vw, 2.5rem); }
  .episode-panel header { display: flex; justify-content: space-between; gap: 2rem; align-items: end; margin-bottom: 1.4rem; }
  h2 { margin: 0.4rem 0 0; font: 800 2.2rem/1 Georgia, serif; }
  header p { max-width: 420px; margin: 0; color: #7a7380; font-size: 0.82rem; line-height: 1.55; }
  footer { display: flex; gap: 1rem; padding: 2rem 0; border-top: 1px solid #e1dce5; color: #837b89; font-size: 0.72rem; }
  footer span { margin-right: auto; }
  footer a { color: inherit; font-weight: 850; text-decoration: none; }
  @media (max-width: 650px) { .show-hero { grid-template-columns: 7rem minmax(0, 1fr); align-items: start; } h1 { font-size: 2.6rem; } .show-copy > p { grid-column: 1 / -1; font-size: 0.85rem; } .episode-panel header { display: block; } header p { margin-top: 0.8rem; } }
</style>
