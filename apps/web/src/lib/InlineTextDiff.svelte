<script lang="ts">
  import type { TextDiffSegment } from '@subtitle-fm/shared';

  let { segments }: { segments: TextDiffSegment[] } = $props();
</script>

<span class="inline-diff">
  {#each segments as segment}
    {#if segment.kind === 'delete'}
      <del class:conflict={segment.conflict}>{segment.text}</del>
    {:else if segment.kind === 'insert'}
      <ins class:conflict={segment.conflict}>{segment.text}</ins>
    {:else}
      <span>{segment.text}</span>
    {/if}
    {#if segment.conflict}
      <sup class="conflict-marker" title="Both sides changed the same base words" aria-label="text conflict">!</sup>
    {/if}
  {/each}
</span>

<style>
  .inline-diff {
    white-space: pre-wrap;
  }
  del,
  ins {
    border-radius: 3px;
    padding: 0.05rem 0.12rem;
  }
  del {
    background: #fee2e2;
    color: #991b1b;
    text-decoration-thickness: 1.5px;
  }
  ins {
    background: #dcfce7;
    color: #166534;
    text-decoration: none;
  }
  del.conflict,
  ins.conflict {
    background: #ede9fe;
    color: #5b21b6;
    outline: 1px solid #8b5cf6;
  }
  .conflict-marker {
    display: inline-grid;
    place-items: center;
    width: 0.9rem;
    height: 0.9rem;
    margin: 0 0.12rem;
    border-radius: 999px;
    background: #7c3aed;
    color: white;
    font-size: 0.64rem;
    font-weight: 800;
    line-height: 1;
    vertical-align: text-top;
  }
</style>
