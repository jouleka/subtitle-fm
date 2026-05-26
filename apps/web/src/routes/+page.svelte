<script lang="ts">
  import { authClient } from "$lib/auth-client";

  let { data } = $props<{ data: { session: { user?: { name?: string } } | null } }>();

  async function signInDiscord() {
    // Absolute URL: Better Auth resolves relative callbackURLs against the api's
    // origin (:3000), not the web's (:5173). Sending the full origin keeps the
    // post-callback redirect on the web app.
    await authClient.signIn.social({
      provider: "discord",
      callbackURL: `${window.location.origin}/`,
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
    <p>Signed in as <strong>{data.session.user.name}</strong></p>
    <button onclick={signOut}>Sign out</button>
  {:else}
    <button onclick={signInDiscord}>Sign in with Discord</button>
  {/if}
</main>
