<script lang="ts">
  import SiteHeader from '$lib/SiteHeader.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData | null } = $props();
  let copied = $state(false);

  const tierLabel = $derived(data.access.tier === 'dev' ? 'Developer' : data.access.tier === 'pro' ? 'Pro' : 'Free');

  function formatDate(value: string | null): string {
    if (!value) return 'Never';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  async function copySecret(secret: string) {
    await navigator.clipboard.writeText(secret);
    copied = true;
    setTimeout(() => (copied = false), 1800);
  }
</script>

<svelte:head>
  <title>API dashboard — Subtitle.fm</title>
  <meta name="description" content="Manage Subtitle.fm API keys and inspect daily request usage." />
</svelte:head>

<div class="page-shell">
  <SiteHeader user={data.session?.user ?? null} />
  <main>
    <header class="dashboard-heading">
      <div>
        <span class="eyebrow">Developer access</span>
        <h1>API dashboard</h1>
        <p>Create credentials and keep an eye on every metered request.</p>
      </div>
      <div class="tier-card">
        <span>{tierLabel} tier</span>
        <strong>{data.access.dailyLimit === null ? 'Unlimited' : `${data.access.dailyLimit} / day`}</strong>
        <small>Token-bucket limit per credential</small>
      </div>
    </header>

    {#if form?.message}<div class="notice error" role="alert">{form.message}</div>{/if}
    {#if form?.secret}
      <section class="secret-card" aria-labelledby="new-key-title">
        <div>
          <span>Shown once</span>
          <h2 id="new-key-title">Save your new API key</h2>
          <p>It is stored as a one-way hash and cannot be recovered later.</p>
        </div>
        <code>{form.secret}</code>
        <button type="button" onclick={() => copySecret(form.secret!)}>{copied ? 'Copied' : 'Copy key'}</button>
      </section>
    {/if}

    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-heading">
          <div><span class="eyebrow">Credentials</span><h2>API keys</h2></div>
          <form method="POST" action="?/createKey" class="create-form">
            <label><span>Key name</span><input name="name" maxlength="80" placeholder="My Bazarr server" required /></label>
            <button type="submit">Create key</button>
          </form>
        </div>

        {#if data.access.keys.length === 0}
          <div class="empty-state"><strong>No API keys yet</strong><p>Create one to call the metered developer endpoint.</p></div>
        {:else}
          <div class="key-list">
            {#each data.access.keys as key (key.id)}
              <article class="key-row">
                <div class="key-identity"><strong>{key.name}</strong><code>{key.prefix}</code><small>Created {formatDate(key.createdAt)}</small></div>
                <dl>
                  <div><dt>Today</dt><dd>{key.todayUsage}</dd></div>
                  <div><dt>30 days</dt><dd>{key.last30DaysUsage}</dd></div>
                  <div><dt>Last used</dt><dd>{formatDate(key.lastUsedAt)}</dd></div>
                </dl>
                <form method="POST" action="?/revokeKey">
                  <input type="hidden" name="id" value={key.id} />
                  <button class="revoke" type="submit">Revoke</button>
                </form>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <aside class="panel quickstart">
        <span class="eyebrow">Quick start</span>
        <h2>Request subtitles</h2>
        <p>Send the key as a bearer token. IMDb, Kitsu, and MAL identifiers use the same format as the Stremio handler.</p>
        <pre><code>curl -H 'Authorization: Bearer YOUR_KEY' \
  '/v1/subtitles/series/tt123:1:1'</code></pre>
        <ul>
          <li><b>Anonymous</b><span>5 requests / day</span></li>
          <li><b>Signed-in free</b><span>20 requests / day</span></li>
          <li><b>Developer</b><span>1,000 requests / day</span></li>
          <li><b>Pro</b><span>No daily cap</span></li>
        </ul>
        <p class="rate-note">Every response includes <code>X-RateLimit-*</code> headers. A depleted bucket returns <code>429</code> with <code>Retry-After</code>.</p>
      </aside>
    </div>
  </main>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f8f6fb; color: #1c1823; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
  .page-shell { min-height: 100vh; }
  main { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 4rem 0 7rem; }
  .dashboard-heading { display: flex; align-items: end; justify-content: space-between; gap: 2rem; margin-bottom: 2rem; }
  .eyebrow { color: #7c3aed; font-size: 0.68rem; font-weight: 900; letter-spacing: 0.15em; text-transform: uppercase; }
  h1 { margin: 0.45rem 0 0.6rem; font: 850 clamp(2.7rem, 6vw, 4.8rem)/0.95 Georgia, serif; letter-spacing: -0.05em; }
  .dashboard-heading p { max-width: 620px; margin: 0; color: #706978; line-height: 1.65; }
  .tier-card { min-width: 230px; border: 1px solid #dcd5e4; border-radius: 1rem; background: white; padding: 1.1rem 1.25rem; box-shadow: 0 14px 35px rgb(51 37 66 / 0.08); }
  .tier-card span, .tier-card small { display: block; color: #89818e; font-size: 0.72rem; }
  .tier-card strong { display: block; margin: 0.3rem 0; font-size: 1.35rem; }
  .notice { margin-bottom: 1rem; border-radius: 0.7rem; padding: 0.8rem 1rem; }
  .error { background: #fee2e2; color: #991b1b; }
  .secret-card { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 1rem; margin-bottom: 1rem; border: 1px solid #c4b5fd; border-radius: 1rem; background: #f5f3ff; padding: 1.2rem; }
  .secret-card span { color: #7c3aed; font-size: 0.68rem; font-weight: 900; text-transform: uppercase; }
  .secret-card h2 { margin: 0.2rem 0; font-size: 1rem; }
  .secret-card p { margin: 0; color: #6d6474; font-size: 0.78rem; }
  .secret-card > code { max-width: 420px; overflow: auto; border-radius: 0.45rem; background: #25202e; padding: 0.75rem; color: #ede9fe; white-space: nowrap; }
  button { border: 0; border-radius: 0.55rem; background: #6d28d9; padding: 0.7rem 0.9rem; color: white; font: 800 0.78rem/1 inherit; cursor: pointer; }
  .dashboard-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 1rem; align-items: start; }
  .panel { border: 1px solid #e1dbe7; border-radius: 1rem; background: white; padding: 1.25rem; box-shadow: 0 15px 40px rgb(51 37 66 / 0.06); }
  .panel-heading { display: flex; justify-content: space-between; gap: 1rem; align-items: end; padding-bottom: 1rem; border-bottom: 1px solid #eee9f1; }
  .panel h2 { margin: 0.25rem 0 0; font-size: 1.25rem; letter-spacing: -0.02em; }
  .create-form { display: flex; align-items: end; gap: 0.55rem; }
  .create-form label { display: grid; gap: 0.3rem; color: #746c7a; font-size: 0.68rem; font-weight: 800; }
  input { min-width: 180px; border: 1px solid #dcd5e3; border-radius: 0.5rem; padding: 0.64rem 0.72rem; font: inherit; }
  .empty-state { padding: 4rem 1rem; text-align: center; }
  .empty-state p { color: #817987; }
  .key-list { display: grid; }
  .key-row { display: grid; grid-template-columns: minmax(150px, 0.8fr) 1.4fr auto; align-items: center; gap: 1rem; padding: 1rem 0; border-bottom: 1px solid #eee9f1; }
  .key-row:last-child { border-bottom: 0; }
  .key-identity { display: grid; gap: 0.25rem; min-width: 0; }
  .key-identity code { overflow: hidden; color: #6d28d9; font-size: 0.73rem; text-overflow: ellipsis; }
  .key-identity small { color: #9a929f; font-size: 0.65rem; }
  dl { display: grid; grid-template-columns: 0.55fr 0.7fr 1.4fr; gap: 0.7rem; margin: 0; }
  dl div { min-width: 0; }
  dt { color: #99919e; font-size: 0.62rem; font-weight: 800; text-transform: uppercase; }
  dd { overflow: hidden; margin: 0.25rem 0 0; font-size: 0.76rem; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
  .revoke { background: transparent; color: #a13b4b; }
  .quickstart > p { color: #746d79; font-size: 0.82rem; line-height: 1.55; }
  pre { overflow: auto; border-radius: 0.7rem; background: #211c29; padding: 1rem; color: #e9ddff; font-size: 0.7rem; line-height: 1.65; }
  ul { display: grid; gap: 0.55rem; margin: 1.2rem 0; padding: 0; list-style: none; }
  li { display: flex; justify-content: space-between; gap: 1rem; color: #716a77; font-size: 0.75rem; }
  li b { color: #29232f; }
  .rate-note code { color: #6d28d9; }
  @media (max-width: 900px) {
    .dashboard-grid { grid-template-columns: 1fr; }
    .quickstart { grid-row: 1; }
  }
  @media (max-width: 680px) {
    main { padding-top: 2rem; }
    .dashboard-heading, .panel-heading { align-items: stretch; flex-direction: column; }
    .tier-card { min-width: 0; }
    .secret-card { grid-template-columns: 1fr; }
    .secret-card > code { max-width: 100%; }
    .create-form { align-items: stretch; flex-direction: column; }
    input { width: 100%; }
    .key-row { grid-template-columns: 1fr auto; }
    .key-row dl { grid-column: 1 / -1; grid-row: 2; }
  }
</style>
