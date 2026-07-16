<script lang="ts">
  import SiteHeader from '$lib/SiteHeader.svelte';
  import EpisodeList from '$lib/EpisodeList.svelte';
  import { authClient } from '$lib/auth-client';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData | null } = $props();
  let user = $derived(data.session?.user ?? null);
  let values = $derived(form?.values);

  async function signInDiscord() {
    await authClient.signIn.social({ provider: 'discord', callbackURL: `${window.location.origin}/#submit` });
  }
</script>

<svelte:head>
  <title>Subtitle.fm — Fansubs done right</title>
  <meta name="description" content="Community-polished subtitles with faithful translation, careful timing, and human review." />
  <meta property="og:title" content="Subtitle.fm — Fansubs done right" />
  <meta property="og:description" content="Discover, improve, and publish community-polished subtitles." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={data.canonical} />
  <link rel="canonical" href={data.canonical} />
</svelte:head>

<div class="page-shell">
  <SiteHeader user={user} />

  <main>
    <section class="hero">
      <div class="hero-copy">
        <span class="eyebrow">Made by people who care about the line</span>
        <h1>Fansubs done right.<br /><em>Together.</em></h1>
        <p>Thoughtful translation, precise timing, and community review — with modern tools handling the repetitive work, not the voice.</p>
        <div class="hero-actions">
          <a class="primary" href="#shows">Browse subtitles</a>
          <a class="secondary" href="#submit">Submit an episode</a>
        </div>
        <dl>
          <div><dt>{data.catalog.length}</dt><dd>shows</dd></div>
          <div><dt>{data.episodeCount}</dt><dd>episodes</dd></div>
          <div><dt>ASS · SRT · VTT</dt><dd>open formats</dd></div>
        </dl>
      </div>
      <div class="hero-art" aria-label="Subtitle editing preview">
        <div class="screen-bar"><i></i><i></i><i></i><span>community edit</span></div>
        <div class="video-frame">
          <div class="caption">The meaning stays with us.</div>
        </div>
        <div class="timeline"><span></span><b></b><span></span></div>
        <div class="cue-card"><strong>03:42.180</strong><p>The meaning stays with us.</p><i>reviewed by 3 contributors</i></div>
      </div>
    </section>

    <section id="shows" class="catalog-section">
      <div class="section-heading">
        <div><span class="eyebrow">The catalog</span><h2>Find your next subtitle</h2></div>
        <p>Every release is visible from first upload through community review and publication.</p>
      </div>

      {#if data.catalog.length === 0}
        <div class="catalog-empty">
          <span aria-hidden="true">◎</span>
          <h3>The first show starts here</h3>
          <p>There are no catalog entries yet. Sign in to help seed the first community release.</p>
          <a href="#submit">Go to submission</a>
        </div>
      {:else}
        <div class="show-grid">
          {#each data.catalog as show (show.id)}
            <article class="show-card">
              <a class="cover" href={`/shows/${show.slug}`} aria-label={`View ${show.title}`}>
                {#if show.coverUrl}<img src={show.coverUrl} alt="" />{:else}<span>{show.title.slice(0, 1)}</span>{/if}
                <b>{show.episodes.filter((episode) => episode.status === 'published').length} published</b>
              </a>
              <div class="show-copy">
                <a href={`/shows/${show.slug}`}><h3>{show.title}</h3></a>
                <p>{show.description ?? 'A community subtitle project open for careful contributors.'}</p>
                <EpisodeList episodes={show.episodes} signedIn={Boolean(user)} limit={3} />
                <a class="view-show" href={`/shows/${show.slug}`}>View {show.episodes.length || 'all'} episode{show.episodes.length === 1 ? '' : 's'} →</a>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section id="submit" class="submit-section">
      <div class="submit-intro">
        <span class="eyebrow">Bring the next episode</span>
        <h2>Start with source media.<br />Finish with a release people trust.</h2>
        <p>Submit a publicly reachable media URL. The pipeline prepares timing and a first transcript, then contributors refine every cue in the editor.</p>
        <ol>
          <li><b>1</b><span><strong>Submit</strong><small>Choose the show and source.</small></span></li>
          <li><b>2</b><span><strong>Collaborate</strong><small>Translate, time, and review.</small></span></li>
          <li><b>3</b><span><strong>Publish</strong><small>Release in open subtitle formats.</small></span></li>
        </ol>
      </div>

      <div class="submit-card">
        {#if user}
          <div class="form-heading"><div><span>Signed in as</span><strong>{user.name ?? 'Contributor'}</strong></div><i>Ready to submit</i></div>
          {#if form?.success}
            <div class="form-message success" role="status">
              Episode submitted and queued for preparation.
              <a href={`/episodes/${form.episodeId}/edit`}>Open the editor</a>
            </div>
          {:else if form?.message}
            <div class="form-message error" role="alert">{form.message}</div>
          {/if}
          <form method="POST" action="?/submitEpisode">
            <label class="wide">Show
              <select name="showId" required>
                <option value="" disabled selected={!values?.showId && !data.selectedShowId}>Choose a show</option>
                {#each data.catalog as show}
                  <option value={show.id} selected={(values?.showId ?? data.selectedShowId) === show.id}>{show.title}</option>
                {/each}
              </select>
            </label>
            <label>Season <input name="seasonNumber" type="number" min="0" value={values?.seasonNumber ?? '1'} required /></label>
            <label>Episode <input name="number" type="number" min="0" value={values?.number ?? ''} required /></label>
            <label class="wide">Episode title <input name="title" value={values?.title ?? ''} placeholder="Optional" /></label>
            <label class="wide">Source media URL <input name="sourceUrl" type="url" value={values?.sourceUrl ?? ''} placeholder="https://…/episode.mkv" required /></label>
            <label>Source language <input name="sourceLanguage" minlength="2" maxlength="3" value={values?.sourceLanguage ?? 'ja'} required /></label>
            <label>Subtitle language <input name="targetLanguage" minlength="2" maxlength="3" value={values?.targetLanguage ?? 'en'} required /></label>
            <button type="submit" disabled={data.catalog.length === 0}>Submit episode <span>→</span></button>
            <p>Only submit media you have permission to process. Public links must remain reachable while preparation runs.</p>
          </form>
        {:else}
          <div class="signed-out-state">
            <span class="discord-mark">#</span>
            <h3>Contributors sign in with Discord</h3>
            <p>Your identity follows every cue change, review, and published contribution.</p>
            <button type="button" onclick={signInDiscord}>Continue with Discord <span>→</span></button>
            <small>Browsing and downloading published subtitles never requires an account.</small>
          </div>
        {/if}
      </div>
    </section>
  </main>

  <footer><a class="brand-footer" href="/">Subtitle.fm</a><p>Community-polished subtitles. Built in the open.</p><a href="/sitemap.xml">Sitemap</a></footer>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) { scroll-behavior: smooth; }
  :global(body) { margin: 0; background: #fbfafc; color: #1c1823; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .page-shell { min-height: 100vh; overflow: hidden; }
  main { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; }
  .eyebrow { color: #7c3aed; font-size: 0.72rem; font-weight: 900; letter-spacing: 0.15em; text-transform: uppercase; }
  .hero { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: clamp(2rem, 6vw, 6rem); min-height: 610px; padding: clamp(4rem, 8vw, 7.5rem) 0 5rem; align-items: center; }
  h1 { max-width: 720px; margin: 0.8rem 0 1.35rem; font: 850 clamp(3.4rem, 7vw, 6rem)/0.94 Georgia, 'Times New Roman', serif; letter-spacing: -0.055em; }
  h1 em { color: #6d28d9; font-weight: inherit; }
  .hero-copy > p { max-width: 650px; margin: 0; color: #66606d; font-size: 1.08rem; line-height: 1.72; }
  .hero-actions { display: flex; gap: 0.8rem; margin: 2rem 0 2.7rem; }
  .hero-actions a { border-radius: 999px; padding: 0.8rem 1.15rem; font-size: 0.84rem; font-weight: 850; text-decoration: none; }
  .hero-actions .primary { background: #6d28d9; color: white; box-shadow: 0 10px 24px rgb(109 40 217 / 0.22); }
  .hero-actions .secondary { border: 1px solid #ddd7e5; color: #393241; }
  dl { display: flex; gap: 2rem; margin: 0; }
  dl div { display: grid; gap: 0.18rem; }
  dt { color: #27212f; font-size: 0.9rem; font-weight: 900; }
  dd { margin: 0; color: #938d99; font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; }
  .hero-art { position: relative; transform: rotate(1.5deg); border: 1px solid #dbd5e2; border-radius: 1rem; background: white; padding: 0.75rem; box-shadow: 0 35px 75px rgb(44 32 58 / 0.16); }
  .hero-art::before { position: absolute; z-index: -1; inset: -14% -12%; border-radius: 50%; background: radial-gradient(circle, rgb(196 181 253 / 0.55), transparent 68%); content: ''; }
  .screen-bar { display: flex; height: 2rem; align-items: center; gap: 0.35rem; color: #9a94a1; font-size: 0.65rem; }
  .screen-bar i { width: 0.45rem; height: 0.45rem; border-radius: 50%; background: #dad5df; }
  .screen-bar span { margin-left: auto; }
  .video-frame { display: grid; min-height: 250px; place-items: end center; border-radius: 0.55rem; background: linear-gradient(165deg, rgb(25 20 37 / 0.12), rgb(20 17 30 / 0.82)), linear-gradient(135deg, #b8a7d5, #6f6682); padding: 1.5rem; }
  .caption { border-radius: 0.25rem; background: rgb(0 0 0 / 0.8); padding: 0.35rem 0.55rem; color: white; font-size: 0.88rem; }
  .timeline { display: grid; grid-template-columns: 0.7fr 1.6fr 1fr; gap: 0.25rem; height: 2.5rem; padding: 0.65rem 0; }
  .timeline span, .timeline b { border-radius: 0.2rem; background: #e9e4ef; }
  .timeline b { background: #8b5cf6; }
  .cue-card { border: 1px solid #e6e1eb; border-radius: 0.55rem; padding: 0.75rem; }
  .cue-card strong, .cue-card i { color: #8b8492; font-size: 0.62rem; }
  .cue-card p { margin: 0.3rem 0; font-size: 0.8rem; }
  .catalog-section { padding: 6rem 0; }
  .section-heading { display: flex; justify-content: space-between; gap: 2rem; align-items: end; margin-bottom: 2rem; }
  h2 { margin: 0.45rem 0 0; font: 800 clamp(2.2rem, 4vw, 3.5rem)/1 Georgia, serif; letter-spacing: -0.04em; }
  .section-heading > p { max-width: 420px; margin: 0; color: #746e7b; line-height: 1.65; }
  .show-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.1rem; }
  .show-card { display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); gap: 1.1rem; min-width: 0; border: 1px solid #e4dfe8; border-radius: 1rem; background: white; padding: 0.8rem; box-shadow: 0 8px 25px rgb(39 28 50 / 0.045); }
  .cover { position: relative; display: grid; min-height: 13rem; overflow: hidden; place-items: center; border-radius: 0.7rem; background: linear-gradient(145deg, #e3d9f5, #78608e); color: white; text-decoration: none; }
  .cover img { width: 100%; height: 100%; object-fit: cover; }
  .cover > span { font: 800 4rem/1 Georgia, serif; opacity: 0.85; }
  .cover b { position: absolute; right: 0.4rem; bottom: 0.4rem; left: 0.4rem; border-radius: 0.4rem; background: rgb(24 17 31 / 0.75); padding: 0.35rem; color: white; font-size: 0.62rem; text-align: center; }
  .show-copy { min-width: 0; }
  .show-copy > a { color: inherit; text-decoration: none; }
  .show-copy h3 { margin: 0.35rem 0 0.3rem; font-size: 1.1rem; }
  .show-copy > p { display: -webkit-box; overflow: hidden; margin: 0 0 0.8rem; color: #7b7481; font-size: 0.77rem; line-height: 1.5; line-clamp: 2; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .view-show { display: inline-block; margin-top: 0.7rem; color: #6d28d9 !important; font-size: 0.72rem; font-weight: 850; }
  .catalog-empty { display: grid; min-height: 300px; place-items: center; border: 1px dashed #cfc5db; border-radius: 1rem; padding: 3rem; text-align: center; }
  .catalog-empty > span { color: #8b5cf6; font-size: 3rem; }
  .catalog-empty h3 { margin: 0.4rem 0; font: 800 1.6rem Georgia, serif; }
  .catalog-empty p { max-width: 450px; color: #7b7481; }
  .catalog-empty a { color: #6d28d9; font-weight: 800; }
  .submit-section { display: grid; grid-template-columns: 0.9fr 1.1fr; gap: clamp(2rem, 8vw, 7rem); margin: 5rem 0 7rem; border-radius: 1.5rem; background: #201a2a; padding: clamp(2rem, 5vw, 4.5rem); color: white; }
  .submit-intro h2 { margin-bottom: 1.3rem; }
  .submit-intro > p { color: #bbb2c4; line-height: 1.7; }
  .submit-intro ol { display: grid; gap: 1rem; margin: 2rem 0 0; padding: 0; list-style: none; }
  .submit-intro li { display: flex; gap: 0.8rem; align-items: center; }
  .submit-intro li > b { display: grid; width: 2rem; height: 2rem; place-items: center; border: 1px solid #5a4e69; border-radius: 50%; color: #c4b5fd; font-size: 0.72rem; }
  .submit-intro li span, .submit-intro li strong, .submit-intro li small { display: block; }
  .submit-intro li small { margin-top: 0.1rem; color: #958b9f; }
  .submit-card { align-self: center; border-radius: 1rem; background: white; padding: 1.4rem; color: #201a2a; box-shadow: 0 25px 60px rgb(0 0 0 / 0.2); }
  .form-heading { display: flex; justify-content: space-between; padding-bottom: 1rem; align-items: center; border-bottom: 1px solid #eeeaf1; }
  .form-heading span, .form-heading strong { display: block; }
  .form-heading span { color: #8d8694; font-size: 0.68rem; }
  .form-heading strong { margin-top: 0.15rem; font-size: 0.9rem; }
  .form-heading i { border-radius: 999px; background: #e9f8ee; padding: 0.3rem 0.55rem; color: #197446; font-size: 0.65rem; font-style: normal; font-weight: 850; }
  form { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; margin-top: 1rem; }
  label { display: grid; gap: 0.35rem; color: #554e5d; font-size: 0.7rem; font-weight: 800; }
  label.wide, form > button, form > p { grid-column: 1 / -1; }
  input, select { width: 100%; border: 1px solid #ddd7e3; border-radius: 0.5rem; background: #fbfafc; padding: 0.68rem 0.7rem; color: #211b29; font: 0.78rem system-ui, sans-serif; }
  input:focus, select:focus { border-color: #8b5cf6; outline: 3px solid rgb(139 92 246 / 0.12); }
  form > button, .signed-out-state button { display: flex; justify-content: space-between; border: 0; border-radius: 0.55rem; background: #6d28d9; padding: 0.8rem 0.9rem; color: white; font: 850 0.8rem system-ui, sans-serif; cursor: pointer; }
  form > button:disabled { cursor: not-allowed; opacity: 0.5; }
  form > p { margin: 0; color: #9b95a0; font-size: 0.63rem; line-height: 1.45; }
  .form-message { margin-top: 1rem; border-radius: 0.5rem; padding: 0.65rem; font-size: 0.74rem; }
  .form-message.success { background: #eaf8ef; color: #17673e; }
  .form-message.error { background: #fce8e8; color: #a32727; }
  .form-message a { margin-left: 0.35rem; color: inherit; font-weight: 850; }
  .signed-out-state { display: grid; min-height: 360px; place-items: center; align-content: center; text-align: center; }
  .discord-mark { display: grid; width: 3.5rem; height: 3.5rem; place-items: center; border-radius: 1rem; background: #ede9fe; color: #6d28d9; font-size: 1.8rem; font-weight: 900; }
  .signed-out-state h3 { margin: 1.2rem 0 0.5rem; font: 800 1.4rem Georgia, serif; }
  .signed-out-state p { max-width: 350px; margin: 0 0 1.3rem; color: #77707e; line-height: 1.6; }
  .signed-out-state button { width: min(300px, 100%); }
  .signed-out-state small { margin-top: 1rem; color: #9b95a0; }
  footer { display: flex; width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 2rem 0; align-items: center; gap: 1rem; border-top: 1px solid #e5e0e8; color: #817a87; font-size: 0.72rem; }
  footer p { margin-right: auto; }
  footer a { color: inherit; font-weight: 800; text-decoration: none; }
  footer .brand-footer { color: #251f2c; font-size: 0.9rem; }
  @media (max-width: 920px) { .hero, .submit-section { grid-template-columns: 1fr; } .hero { padding-top: 4rem; } .hero-art { max-width: 620px; } .show-grid { grid-template-columns: 1fr; } }
  @media (max-width: 620px) { main { width: min(100% - 1.25rem, 1180px); } .hero { min-height: 0; } h1 { font-size: 3.25rem; } dl { gap: 1rem; } .section-heading { display: block; } .section-heading > p { margin-top: 1rem; } .show-card { grid-template-columns: 6.2rem minmax(0, 1fr); } .cover { min-height: 10rem; } .submit-section { padding: 1.35rem; } form { grid-template-columns: 1fr; } label, label.wide, form > button, form > p { grid-column: 1; } footer p { display: none; } }
</style>
