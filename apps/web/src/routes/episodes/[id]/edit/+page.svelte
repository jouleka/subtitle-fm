<script lang="ts">
  import { onMount } from "svelte";
  import type { PageData } from "./$types";
  import { HocuspocusProvider } from "@hocuspocus/provider";
  import JASSUB from "jassub";
  import {
    CUES_ARRAY_KEY,
    liveCuesFromDoc,
    retimeCue,
    type LiveCue,
  } from "@subtitle-fm/shared/yjs";
  import { defaultParsedAss, serializeAss } from "@subtitle-fm/ass";
  import { PUBLIC_COLLAB_URL } from "$env/static/public";
  import { jassubAssets } from "$lib/jassub-assets";
  import { exposeDocForDebug } from "$lib/debug-y";
  import { formatMs } from "$lib/format";
  import { initPeaksController, type PeaksController } from "$lib/peaks-controller";
  import type { Cue } from "$lib/types";

  let { data }: { data: PageData } = $props();

  function restCueToLive(c: Cue): LiveCue {
    return {
      id: c.id,
      orderIndex: c.orderIndex,
      startMs: c.startMs,
      endMs: c.endMs,
      text: c.text,
      rawOverrideTags: c.rawOverrideTags,
      styleName: c.styleName,
      speakerId: c.speakerId,
      confidence: c.confidence,
      needsReview: c.needsReview,
    };
  }

  // Initial paint from SSR REST data; Y.Doc takes over once connected.
  let cues = $state<LiveCue[]>(data.cues.map(restCueToLive));
  let connectionStatus = $state<"idle" | "connecting" | "connected" | "disconnected">("idle");
  let activeTab = $state<"video" | "waveform" | "cues">("cues");

  const ready = $derived(data.episode.status === "ready_for_edit");
  const mediaUrl = $derived(data.episode.audioUrl);

  let provider: HocuspocusProvider | null = null;
  let videoEl: HTMLVideoElement | undefined = $state();
  let overviewEl: HTMLDivElement | undefined = $state();
  let zoomviewEl: HTMLDivElement | undefined = $state();
  let jassub: JASSUB | null = null;
  let peaks: PeaksController | null = null;

  // Exposed to the $effect below so it can retry peaks init when the waveform
  // tab becomes visible on narrow viewports (peaks.js refuses to init against
  // zero-dimension containers, which is what `.pane.display:none` produces).
  // Assigned inside onMount and nulled in cleanup so the effect cannot fire
  // after teardown.
  let tryStartPeaks: (() => void) | null = null;

  onMount(() => {
    if (!ready) return;

    const token = data.session?.token;
    if (!token) {
      connectionStatus = "disconnected";
      return;
    }

    connectionStatus = "connecting";

    const refresh = () => {
      if (provider) cues = liveCuesFromDoc(provider.document);
    };

    provider = new HocuspocusProvider({
      url: PUBLIC_COLLAB_URL,
      name: data.episode.id,
      token,
      onStatus({ status }) {
        connectionStatus = status === "connected" ? "connected" : "connecting";
      },
      onDisconnect() {
        connectionStatus = "disconnected";
      },
      onSynced: refresh,
    });

    provider.document.getArray(CUES_ARRAY_KEY).observeDeep(refresh);
    exposeDocForDebug(provider);

    // JASSUB initialisation. Bound to the rendered <video> element via bind:this.
    // Subtitles overlay the video's canvas region — even for audio-only sources,
    // the .pane-video video CSS gives us a min-height JASSUB can draw on.
    if (videoEl) {
      const initialAss = serializeAss(defaultParsedAss(cues));
      jassub = new JASSUB({
        video: videoEl,
        subContent: initialAss,
        workerUrl: jassubAssets.workerUrl,
        wasmUrl: jassubAssets.wasmUrl,
        modernWasmUrl: jassubAssets.modernWasmUrl,
      });
    }

    // peaks.js initialisation is async (the controller dynamic-imports peaks.js
    // to avoid window-at-module-eval). On wide viewports (>=1024px) all panes
    // are visible at mount, so the first call from onMount succeeds. On narrow
    // viewports the waveform pane is display:none until the user picks its tab;
    // the $effect below retries when activeTab changes. Initial render happens
    // inside this IIFE; subsequent cue changes flow through the peaks `$effect`.
    let destroyed = false;
    let peaksInitStarted = false;

    function localTryStartPeaks() {
      if (destroyed) return;
      if (peaksInitStarted) return;
      if (peaks) return;
      if (!data.episode.peaksUrl) return;
      if (!videoEl || !overviewEl || !zoomviewEl || !provider) return;
      // peaks.js refuses to init against zero-dimension containers.
      if (zoomviewEl.offsetWidth === 0 || zoomviewEl.offsetHeight === 0) return;

      peaksInitStarted = true;
      const doc = provider.document;
      const peaksUrl = data.episode.peaksUrl;
      (async () => {
        try {
          const instance = await initPeaksController({
            overviewEl,
            zoomviewEl,
            mediaElement: videoEl,
            peaksUrl,
            onCueRetime: (cueId, startMs, endMs) => {
              const result = retimeCue(doc, cueId, startMs, endMs);
              if (!result.ok) {
                // Abort: Y.Doc unchanged, observer won't fire, so the dragged
                // segment would stay at the invalid position. Force a re-render
                // from current state to snap it back. `cues` is the live $state
                // binding — reads the current value at call time, not a
                // mount-time snapshot.
                peaks?.setCues(cues);
                // peaks?. (not peaks!.) — cleanup may race with a late dragend.
              }
            },
          });
          if (destroyed) {
            instance.destroy();
            return;
          }
          peaks = instance;
          peaks.setCues(cues);
        } catch (err) {
          // Never crash the editor; the placeholder path keeps the rest usable.
          // Do NOT reset peaksInitStarted — a failure here is non-transient
          // (bad .dat, network) and retrying on every tab toggle would loop.
          console.error("[peaks] init failed", err);
        }
      })();
    }

    tryStartPeaks = localTryStartPeaks;
    localTryStartPeaks();

    return () => {
      // Null the function reference BEFORE flipping destroyed so the effect
      // can't fire localTryStartPeaks after teardown.
      tryStartPeaks = null;
      destroyed = true;
      peaks?.destroy();
      peaks = null;
      jassub?.destroy();
      jassub = null;
      provider?.destroy();
      provider = null;
    };
  });

  // Re-render JASSUB whenever the cue list changes. The $effect subscribes to
  // `cues` reactivity; assignments from the Yjs observer (refresh, above)
  // trigger it. Svelte 5 flushes onMount and top-level $effect in source
  // order, so onMount (above) runs FIRST and constructs JASSUB before this
  // effect fires the first time. The `if (!jassub) return` guard handles the
  // !ready / missing-token / missing-videoEl cases where onMount early-returns
  // without constructing JASSUB. Do NOT move this $effect above onMount —
  // doing so would make the guard short-circuit on first run, and the effect
  // would never subscribe to `cues`, silently breaking live updates.
  $effect(() => {
    if (!jassub) return;
    jassub.setTrack(serializeAss(defaultParsedAss(cues)));
  });

  // Sync cues into peaks.js whenever they change. `peaks` is a plain `let`,
  // not $state, so a null→instance assignment does not re-trigger this effect.
  // Initial render is handled by the explicit `peaks.setCues(cues)` inside the
  // IIFE in onMount; subsequent reactivity flows through `cues` changes.
  $effect(() => {
    if (!peaks) return;
    peaks.setCues(cues);
  });

  // Retry peaks init whenever the active tab changes. On narrow viewports
  // (< 1024px), the waveform pane is display:none until the user picks its tab,
  // at which point peaks.js can finally see non-zero container dimensions and
  // initialise. On wide viewports this effect's tryStartPeaks?.() call no-ops
  // because the onMount inline call already initialised peaks.
  $effect(() => {
    // Subscribe to activeTab so this effect re-runs on tab change.
    activeTab;
    tryStartPeaks?.();
  });
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
      <span class="conn">collab: {connectionStatus}</span>
    </nav>

    <section class="pane pane-video" class:tab-active={activeTab === "video"}>
      {#if mediaUrl}
        <video bind:this={videoEl} controls src={mediaUrl}></video>
      {:else}
        <p class="empty">No media URL on this episode.</p>
      {/if}
    </section>

    <section class="pane pane-cues" class:tab-active={activeTab === "cues"}>
      <ol class="cue-list">
        {#each cues as cue (cue.id)}
          <li class="cue" class:needs-review={cue.needsReview}>
            <span class="cue-time">{formatMs(cue.startMs)}–{formatMs(cue.endMs)}</span>
            <span class="cue-text">{cue.text}</span>
            {#if cue.needsReview}<span class="badge">review</span>{/if}
          </li>
        {/each}
        {#if cues.length === 0}
          <li class="empty">No cues yet.</li>
        {/if}
      </ol>
    </section>

    <section class="pane pane-waveform" class:tab-active={activeTab === "waveform"}>
      {#if data.episode.peaksUrl}
        <div class="overview" bind:this={overviewEl}></div>
        <div class="zoomview" bind:this={zoomviewEl}></div>
      {:else}
        <p class="placeholder">Waveform not yet generated for this episode.</p>
      {/if}
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
    align-items: center;
  }
  .tabs button {
    padding: 0.35rem 0.75rem;
    cursor: pointer;
  }
  .tabs button.active {
    background: #222;
    color: white;
  }
  .conn {
    margin-left: auto;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    color: #888;
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
    min-height: 240px;
    background: black;
  }

  .pane-waveform .overview {
    width: 100%;
    height: 60px;
  }
  .pane-waveform .zoomview {
    width: 100%;
    height: 180px;
    margin-top: 0.5rem;
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
    .conn {
      position: fixed;
      top: 0.25rem;
      right: 0.5rem;
      background: rgba(0, 0, 0, 0.05);
      padding: 0.1rem 0.5rem;
      border-radius: 4px;
    }
  }
</style>
