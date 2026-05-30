<script lang="ts">
  import type { GlossaryTerm } from "@subtitle-fm/shared";

  let { terms, onInsert }: { terms: GlossaryTerm[]; onInsert: (targetText: string) => void } = $props();
</script>

<div class="glossary">
  <h2 class="glossary-title">Glossary</h2>
  {#if terms.length === 0}
    <p class="empty">No glossary terms for this show yet.</p>
  {:else}
    <ul class="terms">
      {#each terms as term (term.id)}
        <li>
          <button
            class="term"
            type="button"
            title={term.notes || undefined}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => onInsert(term.targetText)}
          >
            <span class="src">{term.sourceText}</span>
            <span class="arrow">→</span>
            <span class="tgt">{term.targetText}</span>
            <span class="kind">{term.kind}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .glossary { padding: 0.5rem; }
  .glossary-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: #666; margin: 0 0 0.5rem; }
  .terms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .term { display: flex; gap: 0.4rem; align-items: baseline; width: 100%; text-align: left; background: none; border: 1px solid #eee; border-radius: 4px; padding: 0.3rem 0.4rem; cursor: pointer; font: inherit; }
  .term:hover { background: #f5f7ff; border-color: #c7d2fe; }
  .src { font-weight: 600; }
  .arrow { color: #999; }
  .tgt { flex: 1; }
  .kind { font-size: 0.65rem; color: #3730a3; background: #eef2ff; border-radius: 999px; padding: 0 0.4rem; }
  .empty { color: #888; font-style: italic; font-size: 0.85rem; }
</style>
