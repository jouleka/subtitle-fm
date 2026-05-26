<script lang="ts">
  import type { PageData } from "./$types";
  import { formatMs } from "$lib/format";

  let { data }: { data: PageData } = $props();

  let activeTab = $state<"video" | "waveform" | "cues">("cues");

  const ready = $derived(data.episode.status === "ready_for_edit");
  const mediaUrl = $derived(data.episode.audioUrl);
</script>

<svelte:head>
  <title>{data.episode.title ?? `Episode ${data.episode.number}`} — Subtitle.fm</title>
</svelte:head>

{#if !ready}
  <section class="status-placeholder">
    <h1>Episode still processing</h1>
    <p>Current stage: <strong>{data.episode.status}</strong></p>
    <p>Refresh once the pipeline reaches <code>ready_for_edit</code>.</p>
  </section>
{:else}
  <main class="editor">
    <nav class="tabs" aria-label="Editor panes">
      <button class:active={activeTab === "video"} onclick={() => (activeTab = "video")}>Video</button>
      <button class:active={activeTab === "waveform"} onclick={() => (activeTab = "waveform")}>Waveform</button>
      <button class:active={activeTab === "cues"} onclick={() => (activeTab = "cues")}>Cues</button>
    </nav>

    <section class="pane pane-video" class:tab-active={activeTab === "video"}>
      {#if mediaUrl}
        <video controls src={mediaUrl}></video>
      {:else}
        <p class="empty">No media URL on this episode.</p>
      {/if}
    </section>

    <section class="pane pane-cues" class:tab-active={activeTab === "cues"}>
      <ol class="cue-list">
        {#each data.cues as cue (cue.id)}
          <li class="cue" class:needs-review={cue.needsReview}>
            <span class="cue-time">{formatMs(cue.startMs)}–{formatMs(cue.endMs)}</span>
            <span class="cue-text">{cue.text}</span>
            {#if cue.needsReview}<span class="badge">review</span>{/if}
          </li>
        {/each}
        {#if data.cues.length === 0}
          <li class="empty">No cues yet.</li>
        {/if}
      </ol>
    </section>

    <section class="pane pane-waveform" class:tab-active={activeTab === "waveform"}>
      <p class="placeholder">Waveform — SFM-23</p>
    </section>
  </main>
{/if}

<style>
  .editor {
    display: grid;
    grid-template-areas:
      "tabs"
      "video"
      "cues"
      "waveform";
    min-height: 100dvh;
  }

  .tabs {
    grid-area: tabs;
    display: flex;
    gap: 0.25rem;
    padding: 0.5rem;
    border-bottom: 1px solid #ddd;
  }
  .tabs button {
    padding: 0.35rem 0.75rem;
    cursor: pointer;
  }
  .tabs button.active {
    background: #222;
    color: white;
  }

  .pane {
    display: none;
    padding: 1rem;
    overflow: auto;
  }
  .pane.tab-active {
    display: block;
  }
  .pane-video {
    grid-area: video;
  }
  .pane-cues {
    grid-area: cues;
  }
  .pane-waveform {
    grid-area: waveform;
  }
  .pane-video video {
    width: 100%;
    max-height: 100%;
    background: black;
  }

  .cue-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .cue {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    padding: 0.5rem;
    border-bottom: 1px solid #eee;
  }
  .cue.needs-review {
    border-left: 3px solid #f4b400;
    padding-left: 0.5rem;
  }
  .cue-time {
    font-family: ui-monospace, monospace;
    color: #666;
    min-width: 13ch;
  }
  .cue-text {
    flex: 1;
  }
  .badge {
    background: #f4b400;
    color: #222;
    font-size: 0.7rem;
    padding: 0 0.35rem;
    border-radius: 4px;
  }
  .placeholder,
  .empty {
    color: #888;
    font-style: italic;
  }

  .status-placeholder {
    padding: 2rem;
    font-family: system-ui;
  }

  @media (min-width: 1024px) {
    .editor {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-rows: 1fr auto;
      grid-template-areas:
        "video cues"
        "waveform waveform";
    }
    .tabs {
      display: none;
    }
    .pane {
      display: block;
    }
    .pane-waveform {
      border-top: 1px solid #ddd;
    }
  }
</style>
