<script lang="ts">
  import { authClient } from '$lib/auth-client';

  let { user }: { user: { name?: string | null } | null } = $props();

  async function signInDiscord() {
    await authClient.signIn.social({
      provider: 'discord',
      callbackURL: `${window.location.origin}/#submit`,
    });
  }

  async function signOut() {
    await authClient.signOut();
    location.assign('/');
  }
</script>

<header class="site-header">
  <a class="brand" href="/" aria-label="Subtitle.fm home">
    <span class="brand-mark" aria-hidden="true">S</span>
    <span>Subtitle.fm</span>
  </a>
  <nav aria-label="Primary navigation">
    <a href="/#shows">Shows</a>
    <a href="/#submit">Submit</a>
    {#if user}
      <a href="/dashboard">API dashboard</a>
      <span class="user-name">{user.name ?? 'Contributor'}</span>
      <button type="button" class="quiet-button" onclick={signOut}>Sign out</button>
    {:else}
      <button type="button" class="sign-in" onclick={signInDiscord}>Continue with Discord</button>
    {/if}
  </nav>
</header>

<style>
  .site-header { display: flex; width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 1.1rem 0; align-items: center; justify-content: space-between; gap: 1rem; }
  .brand { display: inline-flex; align-items: center; gap: 0.65rem; color: #15131b; font-size: 1.02rem; font-weight: 850; letter-spacing: -0.02em; text-decoration: none; }
  .brand-mark { display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: 0.65rem; background: #6d28d9; color: white; box-shadow: 0 7px 18px rgb(109 40 217 / 0.23); }
  nav { display: flex; align-items: center; gap: 1rem; }
  nav a { color: #5d5967; font-size: 0.88rem; font-weight: 700; text-decoration: none; }
  nav a:hover { color: #6d28d9; }
  button { border: 0; font: inherit; cursor: pointer; }
  .sign-in { border-radius: 999px; background: #201b2c; padding: 0.65rem 1rem; color: white; font-size: 0.82rem; font-weight: 800; }
  .quiet-button { background: transparent; color: #706b79; font-size: 0.78rem; }
  .user-name { max-width: 10rem; overflow: hidden; color: #332d3f; font-size: 0.8rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 680px) {
    .site-header { align-items: flex-start; }
    nav { gap: 0.55rem; }
    nav > a, .user-name { display: none; }
    .sign-in { padding: 0.55rem 0.75rem; }
  }
</style>
