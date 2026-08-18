<script lang="ts">
  import { authClient } from '$lib/auth-client';

  let { user }: { user: { name?: string | null } | null } = $props();

  async function signInDiscord() {
    await authClient.signIn.social({ provider: 'discord', callbackURL: `${window.location.origin}/#submit` });
  }

  async function signOut() {
    await authClient.signOut();
    location.assign('/');
  }
</script>

<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="/" aria-label="Subtitle.fm home">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>Subtitle.fm</span>
    </a>
    <nav aria-label="Primary navigation">
      <a href="/#workflow">Workflow</a>
      <a href="/#difference">Why Subtitle.fm</a>
      <a href="/#catalog">Catalog</a>
      <a href="/dashboard">API</a>
    </nav>
    <div class="account-actions">
      {#if user}
        <span class="user-name"><i></i>{user.name ?? 'Contributor'}</span>
        <button type="button" class="quiet-button" onclick={signOut}>Sign out</button>
      {:else}
        <button type="button" class="sign-in" onclick={signInDiscord}>Contributor sign in <span>↗</span></button>
      {/if}
    </div>
  </div>
</header>

<style>
  .site-header { position: relative; z-index: 20; border-bottom: 1px solid #c9c9c2; background: #f3f1eb; }
  .header-inner { display: flex; width: min(1240px, calc(100% - 3rem)); height: 4.4rem; margin: 0 auto; align-items: center; gap: 2rem; }
  .brand { display: inline-flex; align-items: center; gap: 0.68rem; color: #181c1d; font-size: 0.98rem; font-weight: 850; letter-spacing: -0.035em; text-decoration: none; }
  .brand-mark { display: flex; width: 1.8rem; height: 1.8rem; align-items: flex-end; justify-content: center; gap: 0.12rem; border: 1px solid #303536; border-radius: 50%; padding-bottom: 0.38rem; }
  .brand-mark i { width: 0.11rem; border-radius: 999px; background: #d46f52; }
  .brand-mark i:nth-child(1) { height: 0.35rem; }
  .brand-mark i:nth-child(2) { height: 0.72rem; }
  .brand-mark i:nth-child(3) { height: 0.5rem; }
  nav { display: flex; margin-left: auto; align-items: center; gap: 1.6rem; }
  nav a { color: #5d6564; font-size: 0.69rem; font-weight: 720; text-decoration: none; }
  nav a:hover { color: #b55c45; }
  .account-actions { display: flex; align-items: center; gap: 0.75rem; border-left: 1px solid #c9c9c2; padding-left: 1.4rem; }
  button { border: 0; font: inherit; cursor: pointer; }
  .sign-in { display: flex; align-items: center; gap: 1rem; border: 1px solid #252a2b; border-radius: 0.18rem; background: #252a2b; padding: 0.62rem 0.75rem; color: #f6f4ee; font-size: 0.65rem; font-weight: 800; }
  .sign-in:hover { background: #d46f52; border-color: #d46f52; color: #181c1d; }
  .quiet-button { background: transparent; color: #717877; font-size: 0.65rem; }
  .user-name { display: flex; max-width: 10rem; overflow: hidden; align-items: center; gap: 0.4rem; color: #303637; font-size: 0.67rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
  .user-name i { width: 0.4rem; height: 0.4rem; border-radius: 50%; background: #63846d; }

  @media (max-width: 860px) {
    .header-inner { width: min(100% - 2rem, 1240px); }
    nav { gap: 1rem; }
    nav a:nth-child(2), nav a:nth-child(4) { display: none; }
  }

  @media (max-width: 620px) {
    .header-inner { width: min(100% - 1.25rem, 1240px); height: 4rem; gap: 0.75rem; }
    nav { display: none; }
    .account-actions { margin-left: auto; border-left: 0; padding-left: 0; }
    .sign-in { padding: 0.55rem 0.65rem; }
    .sign-in span { display: none; }
    .user-name { max-width: 7rem; }
  }
</style>
