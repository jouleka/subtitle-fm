<script lang="ts">
  import { PUBLIC_API_URL } from '$env/static/public';
  import SiteHeader from '$lib/SiteHeader.svelte';
  import SiteFooter from '$lib/SiteFooter.svelte';
  import EpisodeList from '$lib/EpisodeList.svelte';
  import LandingEditorPreview from '$lib/LandingEditorPreview.svelte';
  import { authClient } from '$lib/auth-client';
  import { isUnsupportedMediaPageUrl, readableSourceBytes, sourceContentType } from '$lib/source-media';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData | null } = $props();
  let user = $derived(data.session?.user ?? null);
  let values = $derived(form?.values);
  let duplicateEpisodeId = $derived(readExistingEpisodeId(form));
  let sourceUrlInput = $state<HTMLInputElement>();
  let sourceFile = $state<File | null>(null);
  let sourceError = $state('');
  let uploadState = $state<'idle' | 'preparing' | 'uploading' | 'submitting'>('idle');
  let preparedSubmission = false;

  function readExistingEpisodeId(action: ActionData | null): string | null {
    if (!action || typeof action !== 'object' || !('existingEpisodeId' in action)) return null;
    return typeof action.existingEpisodeId === 'string' ? action.existingEpisodeId : null;
  }

  async function signInDiscord() {
    await authClient.signIn.social({ provider: 'discord', callbackURL: `${window.location.origin}/#submit` });
  }

  function selectSourceFile(event: Event) {
    sourceFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
    sourceError = '';
  }

  async function prepareEpisodeSubmission(event: SubmitEvent) {
    if (preparedSubmission) return;
    const formElement = event.currentTarget as HTMLFormElement;
    const directUrl = sourceUrlInput?.value.trim() ?? '';

    if (!sourceFile && !directUrl) {
      event.preventDefault();
      sourceError = 'Choose a media file or provide a direct media URL.';
      return;
    }
    if (!sourceFile && isUnsupportedMediaPageUrl(directUrl)) {
      event.preventDefault();
      sourceError = 'YouTube and Vimeo page links are not direct media files. Upload the source file instead.';
      return;
    }
    if (!sourceFile) return;

    event.preventDefault();
    sourceError = '';
    uploadState = 'preparing';
    try {
      const contentType = sourceContentType(sourceFile);
      const allowedResponse = await fetch(`${PUBLIC_API_URL}/uploads/source/allowed`);
      if (!allowedResponse.ok) throw new Error('Could not verify upload requirements.');
      const allowed = (await allowedResponse.json()) as { contentTypes: string[]; maxBytes: number };
      if (!contentType || !allowed.contentTypes.includes(contentType)) {
        throw new Error('Use MP4, MKV, WebM, MOV, MP3, WAV, FLAC, or OGG media.');
      }
      if (sourceFile.size > allowed.maxBytes) throw new Error('The selected file exceeds the 5 GB upload limit.');

      const presignResponse = await fetch(`${PUBLIC_API_URL}/uploads/source`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ contentType, sizeBytes: sourceFile.size }),
      });
      if (!presignResponse.ok) throw new Error('Could not prepare the media upload.');
      const upload = (await presignResponse.json()) as { uploadUrl: string; getUrl: string };

      uploadState = 'uploading';
      const uploadResponse = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': contentType },
        body: sourceFile,
      });
      if (!uploadResponse.ok) throw new Error('The media upload did not complete. Please try again.');

      if (!sourceUrlInput) throw new Error('The submission form is unavailable.');
      sourceUrlInput.value = upload.getUrl;
      preparedSubmission = true;
      uploadState = 'submitting';
      formElement.requestSubmit();
    } catch (error) {
      uploadState = 'idle';
      sourceError = error instanceof Error ? error.message : 'The source could not be prepared.';
    }
  }

  function submitButtonLabel(): string {
    if (uploadState === 'preparing') return 'Preparing upload…';
    if (uploadState === 'uploading') return 'Uploading media…';
    if (uploadState === 'submitting') return 'Creating episode…';
    return 'Submit episode';
  }
</script>

<svelte:head>
  <title>Subtitle.fm — Professional subtitle production, together</title>
  <meta name="description" content="A professional, collaborative subtitle workspace for transcription, timing, translation, review, and open-format delivery." />
  <meta property="og:title" content="Subtitle.fm — Professional subtitle production, together" />
  <meta property="og:description" content="From AI-assisted first pass to human-reviewed release — one focused workspace for serious subtitle teams." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={data.canonical} />
  <link rel="canonical" href={data.canonical} />
</svelte:head>

<div class="page-shell">
  <SiteHeader user={user} />

  <main>
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <span class="eyebrow"><i></i> Professional subtitle production</span>
        <h1 id="hero-title">Every line,<br />ready for release.</h1>
        <p class="hero-lede">Subtitle.fm brings transcription, translation, frame-accurate timing, collaborative review, and publishing into one focused workspace—without taking editorial control away from the people doing the work.</p>
        <div class="hero-actions">
          <a class="button button-primary" href="#catalog">Explore subtitles <span>↘</span></a>
          <a class="button button-secondary" href="#workflow">See the workflow <span>↓</span></a>
        </div>
        <div class="hero-proof" aria-label="Product standards">
          <div><strong>ASS-native</strong><span>Styling preserved</span></div>
          <div><strong>Browser-based</strong><span>Nothing to install</span></div>
          <div><strong>Human-reviewed</strong><span>Every release traceable</span></div>
        </div>
      </div>

      <div class="hero-product">
        <div class="product-label"><span>Inside the workspace</span><span>Live editorial session · 3 online</span></div>
        <LandingEditorPreview />
        <div class="product-caption">
          <span><b>01</b> Video + waveform timing</span>
          <span><b>02</b> Live cue collaboration</span>
          <span><b>03</b> Review status in context</span>
        </div>
      </div>
    </section>

    <section class="standards" aria-label="Subtitle.fm capabilities">
      <p>One production path from source to published subtitle</p>
      <div>
        <span>AI-assisted preparation</span>
        <span>Realtime collaboration</span>
        <span>Versioned review</span>
        <span>ASS · SRT · VTT delivery</span>
      </div>
    </section>

    <section id="workflow" class="workflow-section">
      <div class="section-intro sticky-intro">
        <span class="eyebrow"><i></i> The production workflow</span>
        <h2>One calm workspace.<br />No broken handoffs.</h2>
        <p>Subtitle work loses quality when context is split across media players, spreadsheets, chat threads, and exported files. Subtitle.fm keeps the full editorial chain connected.</p>
        <a class="text-link" href="#submit">Start a new episode <span>→</span></a>
      </div>

      <div class="workflow-list">
        <article>
          <div class="workflow-number">01</div>
          <div class="workflow-copy">
            <span>Prepare</span>
            <h3>Start ahead, not from zero.</h3>
            <p>Submit source media and receive an AI-assisted transcript and translation draft, synchronized with audio peaks and ready for a human editor.</p>
          </div>
          <div class="mini-ui prepare-ui" aria-hidden="true">
            <div class="source-file"><span>MKV</span><div><strong>episode-04.mkv</strong><small>24:18 · Japanese audio</small></div><i>✓</i></div>
            <div class="process-line"><span></span><span></span><span></span><span></span></div>
            <div class="process-labels"><span>Audio</span><span>Waveform</span><span>Transcript</span><span>Draft</span></div>
          </div>
        </article>

        <article>
          <div class="workflow-number">02</div>
          <div class="workflow-copy">
            <span>Edit</span>
            <h3>Make precise decisions in context.</h3>
            <p>Shape timing against the waveform, preview styled ASS subtitles over video, use keyboard-first cue controls, and keep show terminology close at hand.</p>
          </div>
          <div class="mini-ui edit-ui" aria-hidden="true">
            <div class="time-ruler"><span>18:40</span><span>18:42</span><span>18:44</span></div>
            <svg viewBox="0 0 400 46" preserveAspectRatio="none"><path d="M0 23L6 18L12 30L18 10L24 35L30 16L36 29L42 20L48 26L54 8L60 37L66 14L72 31L78 19L84 27L90 11L96 38L102 17L108 29L114 21L120 25L126 9L132 36L138 13L144 32L150 18L156 28L162 10L168 39L174 16L180 30L186 19L192 26L198 8L204 37L210 15L216 31L222 20L228 27L234 12L240 35L246 17L252 29L258 21L264 25L270 9L276 38L282 14L288 32L294 18L300 28L306 11L312 36L318 16L324 30L330 19L336 27L342 8L348 38L354 15L360 31L366 20L372 26L378 11L384 36L390 17L396 28L400 23" /></svg>
            <div class="timed-cue">The signal is still out there.</div>
          </div>
        </article>

        <article>
          <div class="workflow-number">03</div>
          <div class="workflow-copy">
            <span>Review</span>
            <h3>Move fast without losing authorship.</h3>
            <p>Collaborate live, flag uncertain lines, compare branches, resolve cue conflicts deliberately, and keep a visible audit trail of who changed what.</p>
          </div>
          <div class="mini-ui review-ui" aria-hidden="true">
            <div class="diff-head"><span>Branch comparison</span><strong>6 changes</strong></div>
            <div class="diff-row"><span>−</span><p>The signal was still there.</p></div>
            <div class="diff-row added"><span>+</span><p>The signal is still out there.</p></div>
            <div class="reviewed-by"><span>MK</span><span>AL</span><p>Approved by 2 reviewers</p><b>Ready</b></div>
          </div>
        </article>

        <article>
          <div class="workflow-number">04</div>
          <div class="workflow-copy">
            <span>Publish</span>
            <h3>Release once. Deliver openly.</h3>
            <p>Publish reviewed subtitles in open formats, make them discoverable in the catalog, serve them through Stremio, or connect through the metered API.</p>
          </div>
          <div class="mini-ui publish-ui" aria-hidden="true">
            <div class="release-file"><div><span>ASS</span><strong>Styled master</strong></div><i>2.4 MB</i><b>Download</b></div>
            <div class="release-file"><div><span>SRT</span><strong>Universal delivery</strong></div><i>184 KB</i><b>Download</b></div>
            <div class="release-destinations"><span>WEB</span><span>STREMIO</span><span>API</span></div>
          </div>
        </article>
      </div>
    </section>

    <section class="quality-section">
      <div class="quality-heading">
        <span class="eyebrow light"><i></i> Built for the last 10%</span>
        <h2>Automation makes a draft.<br />People make it worth watching.</h2>
        <p>Fast generation is useful. Professional subtitle work still depends on timing, terminology, intent, typography, and accountable review. That is where Subtitle.fm is designed to stay out of your way—and keep the right context in view.</p>
      </div>
      <div class="quality-grid">
        <article><span class="quality-index">A</span><div><h3>Translation with memory</h3><p>Show-level glossaries keep names, places, and recurring language consistent from episode to episode.</p></div></article>
        <article><span class="quality-index">B</span><div><h3>Review where doubt lives</h3><p>Low-confidence and manually flagged cues remain visible until a contributor makes the call.</p></div></article>
        <article><span class="quality-index">C</span><div><h3>Formatting that survives</h3><p>ASS override tags and styled previews stay part of the editing workflow instead of being flattened away.</p></div></article>
        <article><span class="quality-index">D</span><div><h3>History you can inspect</h3><p>Snapshots, cue history, branches, and review decisions make every release explainable.</p></div></article>
      </div>
    </section>

    <section id="difference" class="difference-section">
      <div class="section-intro difference-intro">
        <span class="eyebrow"><i></i> Why Subtitle.fm</span>
        <h2>The craft of a desktop editor.<br />The continuity of a shared platform.</h2>
        <p>Subtitle.fm is built for teams who have outgrown passing subtitle files around, but do not want a black-box generator making final editorial decisions.</p>
      </div>

      <div class="comparison" role="table" aria-label="Subtitle workflow comparison">
        <div class="comparison-row comparison-head" role="row">
          <div role="columnheader">What matters in production</div>
          <div role="columnheader">File-based editors</div>
          <div role="columnheader">AI caption generators</div>
          <div class="ours" role="columnheader">Subtitle.fm</div>
        </div>
        <div class="comparison-row" role="row">
          <div role="cell"><strong>Frame-aware editing</strong><span>Video, cues, and waveform together</span></div>
          <div role="cell"><i class="yes">●</i> Strong</div>
          <div role="cell"><i class="limited">●</i> Varies</div>
          <div class="ours" role="cell"><i class="yes">●</i> Built in</div>
        </div>
        <div class="comparison-row" role="row">
          <div role="cell"><strong>Live team workflow</strong><span>Presence, review, and shared state</span></div>
          <div role="cell"><i class="limited">●</i> File handoffs</div>
          <div role="cell"><i class="limited">●</i> Plan-dependent</div>
          <div class="ours" role="cell"><i class="yes">●</i> Native</div>
        </div>
        <div class="comparison-row" role="row">
          <div role="cell"><strong>Editorial traceability</strong><span>Branches, history, and authorship</span></div>
          <div role="cell"><i class="limited">●</i> Local history</div>
          <div role="cell"><i class="limited">●</i> Limited</div>
          <div class="ours" role="cell"><i class="yes">●</i> Cue-level</div>
        </div>
        <div class="comparison-row" role="row">
          <div role="cell"><strong>Open release path</strong><span>Download, catalog, Stremio, API</span></div>
          <div role="cell"><i class="yes">●</i> File export</div>
          <div role="cell"><i class="limited">●</i> Vendor workflow</div>
          <div class="ours" role="cell"><i class="yes">●</i> Multi-channel</div>
        </div>
        <div class="comparison-note">Different tools solve different parts of the work. Subtitle.fm connects the full path while keeping the finished subtitle portable.</div>
      </div>
    </section>

    <section id="catalog" class="catalog-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow"><i></i> Published work</span>
          <h2>Browse the catalog.</h2>
        </div>
        <div class="catalog-summary">
          <span><strong>{data.catalog.length}</strong> show{data.catalog.length === 1 ? '' : 's'}</span>
          <span><strong>{data.episodeCount}</strong> episode{data.episodeCount === 1 ? '' : 's'}</span>
          <p>Published subtitles are public to browse and download. No account required.</p>
        </div>
      </div>

      {#if data.catalog.length === 0}
        <div class="catalog-empty">
          <div class="empty-index">001</div>
          <div><span class="eyebrow"><i></i> Open catalog</span><h3>The first professional release starts here.</h3><p>The catalog is ready for its first show. Contributors can sign in to submit source media and open a new subtitle project.</p></div>
          <a class="button button-primary" href="#submit">Start the first release <span>→</span></a>
        </div>
      {:else}
        <div class="show-grid">
          {#each data.catalog as show, index (show.id)}
            <article class="show-card">
              <a class="cover" href={`/shows/${show.slug}`} aria-label={`View ${show.title}`}>
                {#if show.coverUrl}<img src={show.coverUrl} alt="" />{:else}<span>{show.title.slice(0, 1)}</span>{/if}
                <span class="cover-index">{String(index + 1).padStart(2, '0')}</span>
              </a>
              <div class="show-copy">
                <div class="show-meta"><span>{show.episodes.filter((episode) => episode.status === 'published').length} published</span><span>{show.episodes.length} total</span></div>
                <a href={`/shows/${show.slug}`}><h3>{show.title}</h3></a>
                <p>{show.description ?? 'A community subtitle project open for faithful translation, precise timing, and careful review.'}</p>
                <EpisodeList episodes={show.episodes} signedIn={Boolean(user)} limit={3} />
                <a class="view-show" href={`/shows/${show.slug}`}>Open release board <span>→</span></a>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section id="submit" class="submit-section">
      <div class="submit-intro">
        <span class="eyebrow light"><i></i> Bring the next episode</span>
        <h2>Source in.<br />Release out.</h2>
        <p>Upload a source media file or provide a direct download URL. Subtitle.fm prepares the audio, waveform, transcript, and translation draft so contributors can focus on the editorial work that matters.</p>
        <ol>
          <li><span>01</span><div><strong>Submit the source</strong><small>Choose the show, episode, and languages.</small></div></li>
          <li><span>02</span><div><strong>Edit with the team</strong><small>Time, translate, style, and resolve review flags.</small></div></li>
          <li><span>03</span><div><strong>Publish the release</strong><small>Deliver through open files, catalog, Stremio, and API.</small></div></li>
        </ol>
      </div>

      <div class="submit-card">
        {#if user}
          <div class="form-heading"><div><span>Contributor session</span><strong>{user.name ?? 'Contributor'}</strong></div><i><b></b> Ready to submit</i></div>
          {#if form?.success}
            <div class="form-message success" role="status">Episode submitted and queued for preparation. <a href={`/episodes/${form.episodeId}/edit`}>Open the editor →</a></div>
          {:else if form?.message}
            <div class="form-message error" role="alert"><span>{form.message}</span>{#if duplicateEpisodeId}<a href={`/episodes/${duplicateEpisodeId}/edit`}>Open existing episode →</a>{/if}</div>
          {/if}
          {#if sourceError}<div class="form-message error source-error" role="alert">{sourceError}</div>{/if}
          <form method="POST" action="?/submitEpisode" onsubmit={prepareEpisodeSubmission}>
            <label class="wide">Show<select name="showId" required><option value="" disabled selected={!values?.showId && !data.selectedShowId}>Choose a show</option>{#each data.catalog as show}<option value={show.id} selected={(values?.showId ?? data.selectedShowId) === show.id}>{show.title}</option>{/each}</select></label>
            <label>Season<input name="seasonNumber" type="number" min="0" value={values?.seasonNumber ?? '1'} required /></label>
            <label>Episode<input name="number" type="number" min="0" value={values?.number ?? ''} required /></label>
            <label class="wide">Episode title<input name="title" value={values?.title ?? ''} placeholder="Optional" /></label>
            <label class="wide source-file-field">Source media file
              <input class="file-input" type="file" accept="video/mp4,video/x-matroska,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/flac,audio/x-flac,audio/ogg,.mkv" onchange={selectSourceFile} disabled={uploadState !== 'idle'} />
              <span class="field-hint">{sourceFile ? `${sourceFile.name} · ${readableSourceBytes(sourceFile.size)}` : 'MP4, MKV, WebM, MOV, MP3, WAV, FLAC, or OGG · up to 5 GB'}</span>
            </label>
            <div class="source-divider"><span>or</span></div>
            <label class="wide">Direct media URL<input name="sourceUrl" type="url" bind:this={sourceUrlInput} value={values?.sourceUrl ?? ''} placeholder="https://media.example/episode.mkv" readonly={uploadState !== 'idle'} /><span class="field-hint">Must download the media file directly. YouTube and Vimeo page links are not supported.</span></label>
            <label>Source language<input name="sourceLanguage" minlength="2" maxlength="3" value={values?.sourceLanguage ?? 'ja'} required /></label>
            <label>Subtitle language<input name="targetLanguage" minlength="2" maxlength="3" value={values?.targetLanguage ?? 'en'} required /></label>
            <button type="submit" disabled={data.catalog.length === 0 || uploadState !== 'idle'}>{submitButtonLabel()} <span>{uploadState === 'idle' ? '→' : '·'}</span></button>
            <p>Only submit media you have permission to process. Uploaded source files are used to prepare this subtitle project.</p>
          </form>
        {:else}
          <div class="signed-out-state">
            <div class="session-label"><span>Contributor access</span><i>Discord identity</i></div>
            <div class="discord-mark" aria-hidden="true">#</div>
            <h3>Continue with your contributor identity.</h3>
            <p>Every cue change, review, and publication stays attributed. Discord keeps access simple without sacrificing accountability.</p>
            <button type="button" onclick={signInDiscord}>Continue with Discord <span>→</span></button>
            <small>Browsing and downloading published subtitles never requires an account.</small>
          </div>
        {/if}
      </div>
    </section>
  </main>

  <SiteFooter />
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html) { scroll-behavior: smooth; scroll-padding-top: 5rem; }
  :global(body) { margin: 0; background: #f3f1eb; color: #171b1d; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  :global(button), :global(input), :global(select) { font: inherit; }
  :global(::selection) { background: #d9785d; color: #171b1d; }
  .page-shell { min-width: 320px; overflow: clip; }
  main { width: min(1240px, calc(100% - 3rem)); margin: 0 auto; }
  .eyebrow { display: inline-flex; align-items: center; gap: 0.5rem; color: #555e5f; font-size: 0.69rem; font-weight: 800; letter-spacing: 0.13em; text-transform: uppercase; }
  .eyebrow i { width: 1.5rem; height: 1px; background: #d46f52; }
  .eyebrow.light { color: #aaaead; }
  h1, h2, h3, p { text-wrap: pretty; }
  h1, h2 { margin: 0; letter-spacing: -0.055em; }
  h1 { max-width: 760px; font-size: clamp(4.2rem, 7.9vw, 7.2rem); font-weight: 650; line-height: 0.9; }
  h2 { font-size: clamp(2.8rem, 5.5vw, 5rem); font-weight: 580; line-height: 0.96; }
  .hero { display: grid; grid-template-columns: minmax(360px, 0.78fr) minmax(560px, 1.22fr); gap: clamp(3rem, 6vw, 6rem); min-height: 760px; padding: clamp(4rem, 8vw, 7.5rem) 0 6rem; align-items: center; }
  .hero-copy { position: relative; z-index: 2; }
  .hero-copy h1 { margin: 1.25rem 0 1.7rem; }
  .hero-lede { max-width: 620px; margin: 0; color: #596162; font-size: clamp(1rem, 1.35vw, 1.12rem); line-height: 1.72; }
  .hero-actions { display: flex; flex-wrap: wrap; gap: 0.7rem; margin: 2rem 0 3.25rem; }
  .button { display: inline-flex; min-height: 3rem; align-items: center; justify-content: space-between; gap: 1.4rem; border: 1px solid #202526; border-radius: 0.2rem; padding: 0.75rem 0.95rem; font-size: 0.79rem; font-weight: 780; text-decoration: none; transition: background 150ms ease, color 150ms ease, transform 150ms ease; }
  .button:hover { transform: translateY(-1px); }
  .button-primary { background: #202526; color: #f8f6f0; }
  .button-primary:hover { background: #d46f52; border-color: #d46f52; color: #171b1d; }
  .button-secondary { border-color: #bbbdb8; color: #343a3b; }
  .button-secondary:hover { border-color: #202526; }
  .hero-proof { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid #c9c9c2; padding-top: 1rem; }
  .hero-proof div { display: grid; gap: 0.22rem; border-right: 1px solid #d1d0c9; padding: 0 0.8rem; }
  .hero-proof div:first-child { padding-left: 0; }
  .hero-proof div:last-child { border-right: 0; }
  .hero-proof strong { font-size: 0.7rem; font-weight: 800; }
  .hero-proof span { color: #7d8382; font-size: 0.59rem; }
  .hero-product { position: relative; min-width: 0; }
  .hero-product::before { position: absolute; z-index: -1; top: -5rem; right: -10vw; bottom: -6rem; left: 33%; background: #deddd6; content: ''; }
  .product-label { display: flex; justify-content: space-between; margin-bottom: 0.7rem; color: #606768; font: 0.58rem ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; letter-spacing: 0.07em; }
  .product-label span:last-child { color: #7d8583; }
  .product-caption { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 0.85rem; gap: 0.5rem; color: #666d6d; font-size: 0.56rem; }
  .product-caption span { display: flex; align-items: center; gap: 0.4rem; }
  .product-caption b { color: #a25e49; font: 0.52rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .standards { display: grid; grid-template-columns: 0.75fr 2.25fr; align-items: center; border-top: 1px solid #bfc0ba; border-bottom: 1px solid #bfc0ba; padding: 1.5rem 0; }
  .standards p { margin: 0; color: #737a79; font-size: 0.66rem; letter-spacing: 0.08em; text-transform: uppercase; }
  .standards div { display: grid; grid-template-columns: repeat(4, 1fr); }
  .standards div span { border-left: 1px solid #c9c9c3; padding: 0.25rem 1rem; color: #2e3435; font-size: 0.72rem; font-weight: 750; }
  .workflow-section { display: grid; grid-template-columns: minmax(320px, 0.8fr) minmax(520px, 1.2fr); gap: clamp(4rem, 8vw, 8rem); padding: 10rem 0; }
  .section-intro h2 { margin: 1.2rem 0 1.7rem; }
  .section-intro > p { max-width: 560px; margin: 0; color: #677070; font-size: 0.95rem; line-height: 1.72; }
  .sticky-intro { position: sticky; top: 8rem; align-self: start; }
  .text-link { display: inline-flex; align-items: center; gap: 1.5rem; margin-top: 2rem; border-bottom: 1px solid #8b8f8b; padding-bottom: 0.35rem; color: #24292a; font-size: 0.75rem; font-weight: 800; text-decoration: none; }
  .text-link span { color: #c36146; }
  .workflow-list { border-top: 1px solid #bfc0ba; }
  .workflow-list article { display: grid; grid-template-columns: 3.2rem 1fr; column-gap: 1.2rem; border-bottom: 1px solid #bfc0ba; padding: 2.7rem 0 3rem; }
  .workflow-number { color: #bd654d; font: 0.65rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .workflow-copy > span { color: #777f7e; font-size: 0.62rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
  .workflow-copy h3 { margin: 0.5rem 0 0.75rem; font-size: clamp(1.4rem, 2vw, 1.85rem); font-weight: 650; letter-spacing: -0.035em; }
  .workflow-copy p { max-width: 590px; margin: 0; color: #6c7373; font-size: 0.82rem; line-height: 1.7; }
  .mini-ui { grid-column: 2; overflow: hidden; margin-top: 1.6rem; border: 1px solid #c4c5bf; border-radius: 0.25rem; background: #e9e7e1; }
  .source-file { display: flex; align-items: center; gap: 0.7rem; padding: 1rem; }
  .source-file > span { display: grid; width: 2.4rem; height: 2.8rem; place-items: center; border: 1px solid #b5b6b1; color: #666e6e; font: 0.55rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .source-file div { display: grid; gap: 0.2rem; }
  .source-file strong { font-size: 0.7rem; }
  .source-file small { color: #858b8a; font-size: 0.56rem; }
  .source-file i { display: grid; width: 1.4rem; height: 1.4rem; margin-left: auto; place-items: center; border-radius: 50%; background: #6f8d7a; color: white; font-size: 0.6rem; font-style: normal; }
  .process-line { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.18rem; padding: 0 1rem; }
  .process-line span { height: 0.28rem; background: #6f8d7a; }
  .process-line span:last-child { background: #c86e53; }
  .process-labels { display: grid; grid-template-columns: repeat(4, 1fr); padding: 0.5rem 1rem 0.8rem; color: #797f7e; font-size: 0.48rem; }
  .time-ruler { display: flex; justify-content: space-between; border-bottom: 1px solid #c7c7c1; padding: 0.45rem 0.7rem; color: #818685; font: 0.47rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .edit-ui svg { display: block; width: 100%; height: 4.2rem; background: #252a2c; }
  .edit-ui path { fill: none; stroke: #9fa8a4; stroke-width: 1; }
  .timed-cue { margin: -0.9rem 18% 0.8rem 28%; border: 1px solid #9a6b5d; background: #ddd5cc; padding: 0.5rem; color: #59423b; font-size: 0.55rem; }
  .diff-head { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #c8c8c2; padding: 0.65rem 0.75rem; color: #697170; font-size: 0.56rem; }
  .diff-head strong { color: #985d4a; }
  .diff-row { display: grid; grid-template-columns: 1.5rem 1fr; background: #e4d8d3; padding: 0.55rem 0.75rem; color: #7c4d43; font-size: 0.6rem; }
  .diff-row.added { border-top: 1px solid #d2c9c2; background: #dbe3dd; color: #465f50; }
  .diff-row p { margin: 0; }
  .reviewed-by { display: flex; align-items: center; padding: 0.75rem; }
  .reviewed-by > span { display: grid; width: 1.6rem; height: 1.6rem; margin-right: -0.3rem; place-items: center; border: 2px solid #e9e7e1; border-radius: 50%; background: #4d5856; color: white; font-size: 0.46rem; }
  .reviewed-by > span:nth-child(2) { background: #725f52; }
  .reviewed-by p { margin: 0 0 0 0.75rem; color: #6f7675; font-size: 0.54rem; }
  .reviewed-by b { margin-left: auto; color: #4e715c; font-size: 0.52rem; }
  .release-file { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 1rem; border-bottom: 1px solid #c6c7c0; padding: 0.75rem; }
  .release-file div { display: flex; align-items: center; gap: 0.7rem; }
  .release-file div span { display: grid; width: 2rem; height: 2rem; place-items: center; border: 1px solid #aeb0aa; color: #646c6c; font: 0.48rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .release-file strong { font-size: 0.63rem; }
  .release-file i { color: #858b8a; font-size: 0.5rem; font-style: normal; }
  .release-file b { border-bottom: 1px solid #858a87; padding-bottom: 0.12rem; font-size: 0.5rem; }
  .release-destinations { display: flex; gap: 0.4rem; padding: 0.7rem; }
  .release-destinations span { border: 1px solid #b9bab4; padding: 0.35rem 0.5rem; color: #68706f; font: 0.45rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .quality-section { width: 100vw; margin-left: calc(50% - 50vw); background: #1d2223; padding: 8rem max(1.5rem, calc((100vw - 1240px) / 2)); color: #f1efe9; }
  .quality-heading { display: grid; grid-template-columns: 1fr 1fr; column-gap: 5rem; }
  .quality-heading .eyebrow { grid-column: 1 / -1; }
  .quality-heading h2 { margin: 1.4rem 0 4rem; }
  .quality-heading > p { align-self: end; margin: 0 0 4rem; color: #a8adac; line-height: 1.75; }
  .quality-grid { display: grid; grid-template-columns: repeat(2, 1fr); border-top: 1px solid #44494a; }
  .quality-grid article { display: grid; grid-template-columns: 2.5rem 1fr; gap: 1rem; min-height: 180px; border-bottom: 1px solid #44494a; padding: 2rem 2rem 2rem 0; }
  .quality-grid article:nth-child(odd) { border-right: 1px solid #44494a; }
  .quality-grid article:nth-child(even) { padding-left: 2rem; }
  .quality-index { color: #d9785d; font: 0.62rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .quality-grid h3 { margin: 0 0 0.7rem; font-size: 1.12rem; font-weight: 620; letter-spacing: -0.025em; }
  .quality-grid p { max-width: 480px; margin: 0; color: #969d9c; font-size: 0.77rem; line-height: 1.68; }
  .difference-section { padding: 10rem 0; }
  .difference-intro { display: grid; grid-template-columns: 1.15fr 0.85fr; column-gap: 5rem; }
  .difference-intro .eyebrow { grid-column: 1 / -1; }
  .difference-intro h2 { margin-bottom: 3.5rem; }
  .difference-intro > p { align-self: end; margin-bottom: 3.5rem; }
  .comparison { border-top: 1px solid #aeb0aa; }
  .comparison-row { display: grid; grid-template-columns: 1.35fr repeat(3, 0.85fr); border-bottom: 1px solid #c4c5bf; }
  .comparison-row > div { display: flex; min-height: 5rem; align-items: center; gap: 0.45rem; border-left: 1px solid #d0d0ca; padding: 1rem; color: #6b7271; font-size: 0.66rem; }
  .comparison-row > div:first-child { display: grid; gap: 0.28rem; border-left: 0; padding-left: 0; }
  .comparison-row > div:first-child strong { color: #24292a; font-size: 0.76rem; }
  .comparison-row > div:first-child span { color: #858a89; font-size: 0.6rem; }
  .comparison-row > div.ours { background: #e5e2da; color: #29302f; font-weight: 750; }
  .comparison-head > div { min-height: 3.3rem; color: #6d7473; font-size: 0.58rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; }
  .comparison-head > div.ours { color: #a25642; }
  .comparison-row i { font-size: 0.46rem; font-style: normal; }
  .comparison-row i.yes { color: #5a8069; }
  .comparison-row i.limited { color: #b58a5a; }
  .comparison-note { border-bottom: 1px solid #c4c5bf; padding: 0.85rem 0; color: #818786; font-size: 0.57rem; }
  .catalog-section { padding: 3rem 0 10rem; }
  .section-heading { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; margin-bottom: 3rem; align-items: end; }
  .section-heading h2 { margin-top: 1.1rem; }
  .catalog-summary { display: grid; grid-template-columns: auto auto 1fr; align-items: end; gap: 1.5rem; }
  .catalog-summary > span { display: grid; color: #757c7b; font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.08em; }
  .catalog-summary strong { color: #272d2e; font-size: 1.6rem; font-weight: 580; letter-spacing: -0.04em; }
  .catalog-summary p { margin: 0; color: #747b7a; font-size: 0.68rem; line-height: 1.55; }
  .catalog-empty { display: grid; grid-template-columns: 0.3fr 1fr auto; gap: 3rem; min-height: 250px; align-items: center; border-top: 1px solid #b6b8b2; border-bottom: 1px solid #b6b8b2; padding: 2rem 0; }
  .empty-index { color: #bd654d; font: 0.62rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .catalog-empty h3 { margin: 0.75rem 0 0.7rem; font-size: clamp(1.7rem, 3vw, 2.5rem); font-weight: 590; letter-spacing: -0.04em; }
  .catalog-empty p { max-width: 610px; margin: 0; color: #727978; font-size: 0.78rem; line-height: 1.7; }
  .show-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid #b7b9b3; }
  .show-card { display: grid; grid-template-columns: 8rem minmax(0, 1fr); gap: 1.3rem; border-bottom: 1px solid #b7b9b3; padding: 1.3rem 1.3rem 1.3rem 0; }
  .show-card:nth-child(odd) { border-right: 1px solid #c3c4be; }
  .show-card:nth-child(even) { padding-left: 1.3rem; }
  .cover { position: relative; display: grid; min-height: 12rem; overflow: hidden; place-items: center; background: #c8c7c0; color: #59605f; text-decoration: none; }
  .cover img { width: 100%; height: 100%; object-fit: cover; }
  .cover > span:not(.cover-index) { font-size: 3.5rem; font-weight: 550; }
  .cover-index { position: absolute; right: 0.4rem; bottom: 0.35rem; background: #1d2223; padding: 0.2rem 0.3rem; color: #eeeae1; font: 0.45rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .show-copy { min-width: 0; }
  .show-meta { display: flex; gap: 0.8rem; color: #898e8d; font-size: 0.52rem; font-weight: 750; text-transform: uppercase; letter-spacing: 0.08em; }
  .show-copy > a { color: inherit; text-decoration: none; }
  .show-copy h3 { margin: 0.7rem 0 0.4rem; font-size: 1.25rem; font-weight: 650; letter-spacing: -0.03em; }
  .show-copy > p { display: -webkit-box; overflow: hidden; margin: 0 0 0.8rem; color: #747b7a; font-size: 0.69rem; line-height: 1.5; line-clamp: 2; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .view-show { display: inline-flex; gap: 1rem; margin-top: 0.75rem; border-bottom: 1px solid #9c9f9b; padding-bottom: 0.2rem; color: #333a3a !important; font-size: 0.62rem; font-weight: 800; }
  .view-show span { color: #bd654d; }
  .submit-section { display: grid; grid-template-columns: 0.85fr 1.15fr; gap: clamp(3rem, 8vw, 8rem); width: 100vw; margin-left: calc(50% - 50vw); background: #1d2223; padding: 8rem max(1.5rem, calc((100vw - 1240px) / 2)); color: #f3f1eb; }
  .submit-intro h2 { margin: 1.3rem 0 1.5rem; }
  .submit-intro > p { max-width: 530px; color: #a3aaa8; font-size: 0.9rem; line-height: 1.72; }
  .submit-intro ol { display: grid; gap: 0; margin: 3rem 0 0; padding: 0; border-top: 1px solid #414748; list-style: none; }
  .submit-intro li { display: grid; grid-template-columns: 2.5rem 1fr; gap: 1rem; border-bottom: 1px solid #414748; padding: 1.1rem 0; }
  .submit-intro li > span { color: #d9785d; font: 0.55rem ui-monospace, SFMono-Regular, Menlo, monospace; }
  .submit-intro li strong, .submit-intro li small { display: block; }
  .submit-intro li strong { font-size: 0.72rem; }
  .submit-intro li small { margin-top: 0.22rem; color: #7f8785; font-size: 0.61rem; }
  .submit-card { align-self: center; border: 1px solid #4a4f50; border-radius: 0.3rem; background: #f0eee8; padding: clamp(1.3rem, 3vw, 2.1rem); color: #1d2223; box-shadow: 0 28px 70px rgb(0 0 0 / 0.22); }
  .form-heading, .session-label { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #c9c9c3; padding-bottom: 1rem; }
  .form-heading span, .form-heading strong { display: block; }
  .form-heading span, .session-label span { color: #7d8382; font-size: 0.57rem; font-weight: 750; text-transform: uppercase; letter-spacing: 0.08em; }
  .form-heading strong { margin-top: 0.2rem; font-size: 0.78rem; }
  .form-heading i { display: flex; align-items: center; gap: 0.3rem; color: #52705e; font-size: 0.56rem; font-style: normal; font-weight: 800; }
  .form-heading i b { width: 0.4rem; height: 0.4rem; border-radius: 50%; background: #658871; }
  form { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; margin-top: 1.2rem; }
  label { display: grid; gap: 0.38rem; color: #565e5d; font-size: 0.61rem; font-weight: 800; }
  label.wide, form > button, form > p { grid-column: 1 / -1; }
  input, select { width: 100%; min-height: 2.75rem; border: 1px solid #c5c6c0; border-radius: 0.16rem; background: #f8f6f1; padding: 0.68rem 0.72rem; color: #202526; font-size: 0.72rem; }
  input:focus, select:focus { border-color: #9f5c49; outline: 2px solid rgb(194 103 78 / 0.18); outline-offset: 1px; }
  form > button, .signed-out-state button { display: flex; min-height: 3rem; align-items: center; justify-content: space-between; border: 1px solid #202526; border-radius: 0.18rem; background: #202526; padding: 0.8rem 0.9rem; color: white; font-size: 0.72rem; font-weight: 800; cursor: pointer; }
  form > button:disabled { cursor: not-allowed; opacity: 0.45; }
  form > p { margin: 0; color: #868b89; font-size: 0.56rem; line-height: 1.5; }
  .form-message { margin-top: 1rem; border: 1px solid; padding: 0.7rem; font-size: 0.68rem; }
  .form-message.success { border-color: #afc3b5; background: #e0ebe4; color: #355a43; }
  .form-message.error { border-color: #d4aaa1; background: #f1ded9; color: #873e31; }
  .form-message.error { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .form-message a { color: inherit; font-weight: 850; white-space: nowrap; }
  .source-error { margin-bottom: -0.1rem; }
  .file-input { padding: 0.35rem; cursor: pointer; }
  .file-input::file-selector-button { height: 2rem; margin-right: 0.7rem; border: 0; border-right: 1px solid #c5c6c0; background: transparent; padding: 0 0.75rem 0 0.35rem; color: #303637; font-size: 0.65rem; font-weight: 800; cursor: pointer; }
  .file-input:disabled { cursor: wait; opacity: 0.65; }
  .field-hint { color: #8a8f8d; font-size: 0.54rem; font-weight: 500; line-height: 1.45; }
  .source-divider { display: flex; grid-column: 1 / -1; align-items: center; gap: 0.7rem; color: #989c99; font: 0.52rem ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
  .source-divider::before, .source-divider::after { height: 1px; flex: 1; background: #d3d3cd; content: ''; }
  .signed-out-state { display: grid; min-height: 410px; align-content: center; }
  .session-label { margin-bottom: 3.5rem; }
  .session-label i { color: #9a5a47; font-size: 0.56rem; font-style: normal; font-weight: 750; }
  .discord-mark { display: grid; width: 3.2rem; height: 3.2rem; place-items: center; border: 1px solid #aeb0aa; color: #343a3a; font-size: 1.4rem; font-weight: 800; }
  .signed-out-state h3 { max-width: 430px; margin: 1.4rem 0 0.7rem; font-size: clamp(1.45rem, 2.5vw, 2.05rem); font-weight: 600; letter-spacing: -0.04em; }
  .signed-out-state p { max-width: 500px; margin: 0 0 1.5rem; color: #6d7473; font-size: 0.76rem; line-height: 1.68; }
  .signed-out-state button { width: min(330px, 100%); }
  .signed-out-state small { margin-top: 1rem; color: #878c8a; font-size: 0.55rem; }

  @media (max-width: 1080px) {
    .hero { grid-template-columns: 1fr; min-height: 0; padding-top: 5rem; }
    .hero-copy { max-width: 780px; }
    .hero-product { width: min(850px, 100%); }
    .hero-product::before { top: -2rem; right: -20vw; left: 20%; }
    .workflow-section { gap: 4rem; }
    .difference-intro { column-gap: 3rem; }
  }

  @media (max-width: 860px) {
    main { width: min(100% - 2rem, 1240px); }
    .standards { grid-template-columns: 1fr; gap: 1rem; }
    .standards div { grid-template-columns: repeat(2, 1fr); row-gap: 1rem; }
    .standards div span:nth-child(odd) { border-left: 0; padding-left: 0; }
    .workflow-section { grid-template-columns: 1fr; padding: 7rem 0; }
    .sticky-intro { position: static; }
    .quality-heading, .difference-intro, .section-heading { grid-template-columns: 1fr; }
    .quality-heading h2, .difference-intro h2 { margin-bottom: 1.5rem; }
    .quality-heading > p, .difference-intro > p { margin-bottom: 3rem; }
    .comparison { overflow-x: auto; }
    .comparison-row { min-width: 760px; }
    .show-grid { grid-template-columns: 1fr; }
    .show-card:nth-child(odd) { border-right: 0; }
    .show-card:nth-child(even) { padding-left: 0; }
    .submit-section { grid-template-columns: 1fr; }
  }

  @media (max-width: 620px) {
    main { width: min(100% - 1.25rem, 1240px); }
    h1 { font-size: clamp(3.55rem, 17vw, 5rem); }
    h2 { font-size: clamp(2.55rem, 12vw, 3.6rem); }
    .hero { gap: 3rem; padding: 3.5rem 0 4rem; }
    .hero-lede { font-size: 0.96rem; }
    .hero-actions .button { width: 100%; }
    .hero-proof { grid-template-columns: 1fr; }
    .hero-proof div { border-right: 0; border-bottom: 1px solid #d1d0c9; padding: 0.75rem 0; }
    .hero-proof div:last-child { border-bottom: 0; }
    .product-label span:last-child, .product-caption { display: none; }
    .hero-product::before { top: -2rem; bottom: -2.5rem; left: 25%; }
    .standards { margin-top: 2.5rem; }
    .standards div { grid-template-columns: 1fr; row-gap: 0; }
    .standards div span { border-bottom: 1px solid #d0d0ca; border-left: 0; padding: 0.8rem 0; }
    .workflow-section { gap: 3rem; padding: 6rem 0; }
    .workflow-list article { grid-template-columns: 2rem 1fr; column-gap: 0.7rem; }
    .mini-ui { grid-column: 1 / -1; }
    .quality-section { padding-top: 6rem; padding-bottom: 6rem; }
    .quality-grid { grid-template-columns: 1fr; }
    .quality-grid article, .quality-grid article:nth-child(even) { border-right: 0; padding: 1.7rem 0; }
    .difference-section { padding: 6rem 0; }
    .comparison { overflow-x: visible; }
    .comparison-row { grid-template-columns: repeat(3, minmax(0, 1fr)); min-width: 0; }
    .comparison-row > div:first-child { grid-column: 1 / -1; min-height: 0; border-bottom: 1px solid #d0d0ca; padding: 0.9rem 0.65rem; }
    .comparison-row > div:not(:first-child) { min-height: 4.1rem; align-items: flex-start; border-left: 0; border-right: 1px solid #d0d0ca; padding: 0.75rem 0.55rem; font-size: 0.57rem; line-height: 1.35; }
    .comparison-row > div:last-child { border-right: 0; }
    .comparison-head > div:first-child { padding-left: 0; }
    .comparison-head > div:not(:first-child) { min-height: 4.3rem; font-size: 0.48rem; }
    .comparison-note { line-height: 1.5; }
    .catalog-section { padding-bottom: 6rem; }
    .catalog-summary { grid-template-columns: auto auto; }
    .catalog-summary p { grid-column: 1 / -1; }
    .catalog-empty { grid-template-columns: 1fr; gap: 1.5rem; }
    .catalog-empty .button { width: 100%; }
    .show-card { grid-template-columns: 6.4rem minmax(0, 1fr); gap: 0.9rem; }
    .cover { min-height: 10rem; }
    .submit-section { padding-top: 6rem; padding-bottom: 6rem; }
    form { grid-template-columns: 1fr; }
    label, label.wide, form > button, form > p { grid-column: 1; }
    .form-message.error { align-items: flex-start; flex-direction: column; }
  }

  @media (prefers-reduced-motion: reduce) {
    :global(html) { scroll-behavior: auto; }
    .button { transition: none; }
  }
</style>
