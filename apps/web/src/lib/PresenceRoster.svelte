<script lang="ts">
  import type { PresenceUser } from "$lib/presence";
  import { m } from "$lib/paraglide/messages";

  let { users }: { users: PresenceUser[] } = $props();
</script>

{#if users.length > 0}
  <span class="roster" aria-label={m.presence_connected_editors()}>
    {#each users as u (u.id)}
      <span class="chip" style:background={u.color} title={u.name}>{u.name}</span>
    {/each}
  </span>
{/if}

<style>
  .roster {
    display: inline-flex;
    gap: 0.25rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .chip {
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    color: white;
    white-space: nowrap;
  }
</style>
