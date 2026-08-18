<script lang="ts">
  import EpisodeList from '$lib/EpisodeList.svelte';
  import SiteFooter from '$lib/SiteFooter.svelte';
  import SiteHeader from '$lib/SiteHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let user = $derived(data.session?.user ?? null);
  let publishedCount = $derived(data.show.episodes.filter((episode) => episode.status === 'published').length);
  let openCount = $derived(data.show.episodes.filter((episode) => ['ready_for_edit', 'in_review'].includes(episode.status)).length);
</script>

<svelte:head>
  <title>{data.show.title} subtitles — Subtitle.fm</title>
  <meta name="description" content={data.show.description ?? `Professional, community-reviewed subtitles for ${data.show.title}.`} />
  <meta property="og:title" content={`${data.show.title} subtitles — Subtitle.fm`} />
  <meta property="og:description" content={data.show.description ?? `Browse and contribute subtitles for ${data.show.title}.`} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={data.canonical} />
  {#if data.show.coverUrl}<meta property="og:image" content={data.show.coverUrl} />{/if}
  <link rel="canonical" href={data.canonical} />
</svelte:head>

<div class="page-shell">
  <SiteHeader user={user} />

  <main>
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/#catalog">Catalog</a><span>/</span><span>{data.show.title}</span>
    </nav>

    <section class="show-hero" aria-labelledby="show-title">
      <div class="cover">
        {#if data.show.coverUrl}
          <img src={data.show.coverUrl} alt={`${data.show.title} cover`} />
        {:else}
          <span class="cover-label">Subtitle project</span>
          <span class="cover-letter">{data.show.title.slice(0, 1)}</span>
          <span class="cover-format">ASS / SRT / VTT</span>
        {/if}
      </div>

      <div class="show-copy">
        <span class="eyebrow"><i></i> Community release board</span>
        <h1 id="show-title">{data.show.title}</h1>
        <p>{data.show.description ?? 'A subtitle project open for faithful translation, precise timing, and accountable review.'}</p>

        <dl class="metadata">
          <div><dt>{data.show.episodes.length}</dt><dd>Episode{data.show.episodes.length === 1 ? '' : 's'}</dd></div>
          <div><dt>{publishedCount}</dt><dd>Published</dd></div>
          <div><dt>{openCount}</dt><dd>Open for editing</dd></div>
        </dl>

        <div class="show-actions">
          <a class="primary-action" href={`/?show=${encodeURIComponent(data.show.id)}#submit`}>Submit an episode <span>→</span></a>
          <a class="secondary-action" href="#episodes">View releases <span>↓</span></a>
        </div>
      </div>
    </section>

    <section id="episodes" class="episode-section" aria-labelledby="episodes-title">
      <header>
        <div><span class="eyebrow"><i></i> Episode index</span><h2 id="episodes-title">Release board.</h2></div>
        <div class="release-note">
          <span>Public delivery</span>
          <p>Published subtitles are available without an account. Contributors sign in to open episodes ready for editorial work.</p>
        </div>
      </header>
      <EpisodeList episodes={data.show.episodes} signedIn={Boolean(user)} />
    </section>
  </main>

  <SiteFooter />
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) { scroll-behavior: smooth; scroll-padding-top: 2rem; }
  :global(body) { margin: 0; background: #f3f1eb; color: #171b1d; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  :global(::selection) { background: #d9785d; color: #171b1d; }
  .page-shell { min-width: 320px; overflow: clip; }
  main { width: min(1240px, calc(100% - 3rem)); margin: 0 auto; }
  .breadcrumb { display: flex; align-items: center; gap: 0.55rem; border-bottom: 1px solid #c5c6c0; padding: 1.5rem 0 0.85rem; color: #858b89; font: 0.58rem ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: 0.07em; }
  .breadcrumb a { color: #515958; font-weight: 750; text-decoration: none; }
  .breadcrumb a:hover { color: #b65d46; }
  .eyebrow { display: inline-flex; align-items: center; gap: 0.5rem; color: #555e5f; font-size: 0.67rem; font-weight: 800; letter-spacing: 0.13em; text-transform: uppercase; }
  .eyebrow i { width: 1.5rem; height: 1px; background: #d46f52; }
  .show-hero { display: grid; grid-template-columns: minmax(220px, 0.65fr) minmax(0, 1.35fr); gap: clamp(3rem, 8vw, 8rem); min-height: 660px; padding: clamp(3rem, 7vw, 6rem) 0; align-items: center; }
  .cover { position: relative; display: grid; width: min(100%, 300px); aspect-ratio: 2 / 3; overflow: hidden; place-items: center; border: 1px solid #b7b9b3; background: #d2d1ca; color: #545c5b; }
  .cover::after { position: absolute; inset: 0.7rem; border: 1px solid rgb(65 73 72 / 0.28); content: ''; pointer-events: none; }
  .cover img { width: 100%; height: 100%; object-fit: cover; }
  .cover-label, .cover-format { position: absolute; z-index: 1; left: 1.4rem; color: #69706f; font: 0.53rem ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; text-transform: uppercase; }
  .cover-label { top: 1.45rem; }
  .cover-format { bottom: 1.45rem; }
  .cover-letter { font-size: clamp(5rem, 10vw, 8rem); font-weight: 520; letter-spacing: -0.07em; }
  .show-copy h1 { max-width: 870px; margin: 1rem 0 1.4rem; font-size: clamp(4.2rem, 8vw, 7.2rem); font-weight: 620; line-height: 0.9; letter-spacing: -0.06em; }
  .show-copy > p { max-width: 720px; margin: 0; color: #626a69; font-size: 1rem; line-height: 1.72; }
  .metadata { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); max-width: 720px; margin: 2.4rem 0 0; border-top: 1px solid #c4c5bf; border-bottom: 1px solid #c4c5bf; }
  .metadata div { display: grid; gap: 0.2rem; border-right: 1px solid #cccdc7; padding: 1rem 1.1rem; }
  .metadata div:first-child { padding-left: 0; }
  .metadata div:last-child { border-right: 0; }
  .metadata dt { color: #252b2b; font-size: 1.35rem; font-weight: 580; letter-spacing: -0.04em; }
  .metadata dd { margin: 0; color: #818786; font-size: 0.56rem; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; }
  .show-actions { display: flex; flex-wrap: wrap; gap: 0.7rem; margin-top: 1.6rem; }
  .show-actions a { display: inline-flex; min-height: 3rem; align-items: center; justify-content: space-between; gap: 1.6rem; border: 1px solid #222728; border-radius: 0.18rem; padding: 0.75rem 0.95rem; font-size: 0.72rem; font-weight: 800; text-decoration: none; }
  .primary-action { background: #222728; color: #f5f3ed; }
  .primary-action:hover { border-color: #d46f52; background: #d46f52; color: #171b1d; }
  .secondary-action { color: #303637; }
  .secondary-action span { color: #bd654d; }
  .episode-section { padding: 4rem 0 8rem; }
  .episode-section > header { display: grid; grid-template-columns: 1fr 0.8fr; gap: 4rem; align-items: end; border-top: 1px solid #aeb0aa; padding: 2rem 0 2.5rem; }
  .episode-section h2 { margin: 0.9rem 0 0; font-size: clamp(2.8rem, 5.5vw, 4.8rem); font-weight: 580; line-height: 0.95; letter-spacing: -0.055em; }
  .release-note { max-width: 520px; justify-self: end; }
  .release-note span { color: #a25c48; font-size: 0.58rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
  .release-note p { margin: 0.55rem 0 0; color: #747b7a; font-size: 0.75rem; line-height: 1.68; }

  @media (max-width: 860px) {
    main { width: min(100% - 2rem, 1240px); }
    .show-hero { grid-template-columns: 11rem minmax(0, 1fr); gap: 2.5rem; min-height: 560px; }
    .show-copy h1 { font-size: clamp(3.5rem, 9vw, 5rem); }
    .episode-section > header { grid-template-columns: 1fr; gap: 1.5rem; }
    .release-note { justify-self: start; }
  }

  @media (max-width: 620px) {
    main { width: min(100% - 1.25rem, 1240px); }
    .show-hero { grid-template-columns: 6.8rem minmax(0, 1fr); gap: 1.2rem; min-height: 0; padding: 3rem 0 4.5rem; align-items: start; }
    .cover { width: 100%; }
    .cover::after { inset: 0.35rem; }
    .cover-label, .cover-format { display: none; }
    .cover-letter { font-size: 3.6rem; }
    .show-copy .eyebrow i { display: none; }
    .show-copy .eyebrow { font-size: 0.54rem; }
    .show-copy h1 { margin-top: 0.65rem; font-size: clamp(2.55rem, 13vw, 3.5rem); }
    .show-copy > p { font-size: 0.78rem; line-height: 1.58; }
    .metadata { grid-template-columns: 1fr; margin-top: 1.3rem; }
    .metadata div { grid-template-columns: 2rem 1fr; align-items: center; border-right: 0; border-bottom: 1px solid #cccdc7; padding: 0.65rem 0; }
    .metadata div:last-child { border-bottom: 0; }
    .metadata dt { font-size: 0.9rem; }
    .show-actions { grid-column: 1 / -1; }
    .show-actions a { width: 100%; }
    .episode-section { padding: 2rem 0 6rem; }
  }
</style>
