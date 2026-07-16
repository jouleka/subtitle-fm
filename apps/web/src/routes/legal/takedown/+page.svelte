<script lang="ts">
  import SiteHeader from '$lib/SiteHeader.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData | null } = $props();
</script>

<svelte:head>
  <title>Copyright requests — Subtitle.fm</title>
  <meta name="description" content="Submit a copyright takedown notice or DMCA counter-notice to Subtitle.fm." />
</svelte:head>

<div class="page-shell">
  <SiteHeader user={data.session?.user ?? null} />
  <main>
    <header class="hero">
      <span class="eyebrow">Copyright process</span>
      <h1>Takedown and counter-notice requests</h1>
      <p>Use these forms to identify specific Subtitle.fm material. Submissions are private and reviewed by an administrator.</p>
    </header>

    <section class="agent-card" aria-labelledby="agent-title">
      <div><span class="step">DMCA contact</span><h2 id="agent-title">Designated agent</h2></div>
      {#if data.agent.name && data.agent.email && data.agent.address}
        <address><strong>{data.agent.name}</strong><br />{data.agent.address}<br /><a href={`mailto:${data.agent.email}`}>{data.agent.email}</a></address>
      {:else}
        <p>Agent registration details are pending publication. The forms below are active and route requests into the review queue.</p>
      {/if}
    </section>

    <div class="form-grid">
      <section class="panel" aria-labelledby="notice-title">
        <span class="step">Step 1</span>
        <h2 id="notice-title">Copyright takedown notice</h2>
        <p>For a copyright owner or an agent authorized to act for one.</p>
        {#if form?.kind === 'notice' && form?.message}<div class="notice error" role="alert">{form.message}</div>{/if}
        {#if form?.kind === 'notice' && form?.submitted}
          <div class="notice success" role="status"><strong>Notice received.</strong><br />Tracking ID: <code>{form.trackingId}</code></div>
        {:else}
          <form method="POST" action="?/notice">
            <div class="two"><label>Full legal name<input name="claimantName" autocomplete="name" required /></label><label>Email<input name="claimantEmail" type="email" autocomplete="email" required /></label></div>
            <div class="two"><label>Phone<input name="claimantPhone" type="tel" autocomplete="tel" required /></label><label>Electronic signature<input name="signature" required /></label></div>
            <label>Mailing address<textarea name="claimantAddress" rows="3" autocomplete="street-address" required></textarea></label>
            <label>Copyrighted work<textarea name="copyrightedWork" rows="4" placeholder="Identify the work claimed to be infringed." required></textarea></label>
            <label>Subtitle.fm material URL<input name="materialUrl" type="url" placeholder="https://…/episodes/…/subtitle.srt" required /></label>
            <label class="check"><input name="goodFaithConfirmed" type="checkbox" required /><span>I have a good-faith belief that this use is not authorized by the owner, its agent, or the law.</span></label>
            <label class="check"><input name="accuracyConfirmed" type="checkbox" required /><span>I state that this notice is accurate and, under penalty of perjury, that I am authorized to act for the copyright owner.</span></label>
            <button type="submit">Submit takedown notice</button>
          </form>
        {/if}
      </section>

      <section class="panel" aria-labelledby="counter-title">
        <span class="step">After removal</span>
        <h2 id="counter-title">Counter-notice</h2>
        <p>For the person whose material was removed because of mistake or misidentification.</p>
        {#if form?.kind === 'counter' && form?.message}<div class="notice error" role="alert">{form.message}</div>{/if}
        {#if form?.kind === 'counter' && form?.submitted}
          <div class="notice success" role="status"><strong>Counter-notice received.</strong><br />Eligible review date: {new Date(form.restoreEligibleAt!).toLocaleDateString()}</div>
        {:else}
          <form method="POST" action="?/counter">
            <label>Notice tracking ID<input name="noticeId" required /></label>
            <div class="two"><label>Full legal name<input name="submitterName" autocomplete="name" required /></label><label>Email<input name="submitterEmail" type="email" autocomplete="email" required /></label></div>
            <div class="two"><label>Phone<input name="submitterPhone" type="tel" autocomplete="tel" required /></label><label>Electronic signature<input name="signature" required /></label></div>
            <label>Mailing address<textarea name="submitterAddress" rows="3" autocomplete="street-address" required></textarea></label>
            <label>Former material URL<input name="removedMaterialUrl" type="url" required /></label>
            <label class="check"><input name="mistakeConfirmed" type="checkbox" required /><span>Under penalty of perjury, I have a good-faith belief that the material was removed due to mistake or misidentification.</span></label>
            <label class="check"><input name="jurisdictionConfirmed" type="checkbox" required /><span>I consent to the applicable U.S. Federal District Court jurisdiction.</span></label>
            <label class="check"><input name="serviceConfirmed" type="checkbox" required /><span>I will accept service of process from the original claimant or their agent.</span></label>
            <button type="submit">Submit counter-notice</button>
          </form>
        {/if}
      </section>
    </div>

    <p class="legal-note">Submitting false information may create legal liability. This page describes the platform process and is not legal advice.</p>
  </main>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; background: #f8f6fb; color: #1c1823; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 4rem 0 7rem; }
  .hero { max-width: 780px; margin-bottom: 2rem; }
  .eyebrow, .step { color: #7c3aed; font-size: .68rem; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
  h1 { margin: .5rem 0 1rem; font: 850 clamp(2.7rem, 6vw, 4.8rem)/.98 Georgia, serif; letter-spacing: -.05em; }
  h2 { margin: .35rem 0 .55rem; font-size: 1.35rem; letter-spacing: -.025em; }
  p { color: #716a78; line-height: 1.65; }
  .agent-card { display: flex; justify-content: space-between; gap: 2rem; align-items: center; margin-bottom: 1rem; border: 1px solid #d8cbea; border-radius: 1rem; background: #f2edfb; padding: 1.2rem 1.35rem; }
  .agent-card h2 { margin-bottom: 0; }
  .agent-card p, address { max-width: 590px; margin: 0; color: #655c6e; font-style: normal; line-height: 1.55; }
  .agent-card a { color: #6d28d9; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; align-items: start; }
  .panel { border: 1px solid #e1dbe7; border-radius: 1rem; background: white; padding: 1.35rem; box-shadow: 0 15px 40px rgb(51 37 66 / .06); }
  .panel > p { margin-top: 0; font-size: .85rem; }
  form { display: grid; gap: .9rem; margin-top: 1.2rem; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
  label { display: grid; gap: .35rem; color: #554e5c; font-size: .72rem; font-weight: 800; }
  input, textarea { width: 100%; border: 1px solid #d8d1df; border-radius: .55rem; background: #fff; padding: .72rem .78rem; color: #241f29; font: 400 .88rem/1.4 inherit; }
  textarea { resize: vertical; }
  input:focus, textarea:focus { outline: 3px solid #ede9fe; border-color: #8b5cf6; }
  .check { display: grid; grid-template-columns: auto 1fr; gap: .65rem; align-items: start; font-weight: 600; line-height: 1.5; }
  .check input { width: 1rem; margin-top: .15rem; }
  button { justify-self: start; border: 0; border-radius: .6rem; background: #6d28d9; padding: .78rem 1rem; color: white; font: 850 .78rem/1 inherit; cursor: pointer; }
  .notice { margin: 1rem 0; border-radius: .65rem; padding: .8rem .9rem; font-size: .8rem; line-height: 1.55; }
  .error { background: #fee2e2; color: #991b1b; }
  .success { background: #ecfdf5; color: #166534; }
  .success code { color: inherit; }
  .legal-note { margin: 1.5rem 0 0; font-size: .72rem; }
  @media (max-width: 850px) { .form-grid { grid-template-columns: 1fr; } }
  @media (max-width: 600px) { main { padding-top: 2rem; } .agent-card { align-items: flex-start; flex-direction: column; } .two { grid-template-columns: 1fr; } }
</style>
