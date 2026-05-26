<script lang="ts">
  import { authClient } from "$lib/auth-client";

  let { data } = $props<{ data: { session: { user?: { handle?: string; name?: string } } | null } }>();

  async function signInDiscord() {
    await authClient.signIn.social({
      provider: "discord",
      callbackURL: "/",
    });
  }

  async function signOut() {
    await authClient.signOut();
    location.reload();
  }
</script>

<main style="font-family: system-ui; padding: 2rem;">
  <h1>Subtitle.fm</h1>
  {#if data?.session?.user}
    <p>Signed in as <strong>{data.session.user.handle ?? data.session.user.name}</strong></p>
    <button onclick={signOut}>Sign out</button>
  {:else}
    <button onclick={signInDiscord}>Sign in with Discord</button>
  {/if}
</main>
