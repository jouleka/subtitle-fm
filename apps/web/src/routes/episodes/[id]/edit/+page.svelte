<script lang="ts">
  import { onMount } from "svelte";
  import type { PageData } from "./$types";
  import { HocuspocusProvider } from "@hocuspocus/provider";
  import JASSUB from "jassub";
  import {
    CUES_ARRAY_KEY,
    liveCuesFromDoc,
    retimeCue,
    applyCueTextEdit,
    toggleCueNeedsReview,
    type LiveCue,
  } from "@subtitle-fm/shared/yjs";
  import { defaultParsedAss, serializeAss } from "@subtitle-fm/ass";
  import { PUBLIC_COLLAB_URL, PUBLIC_API_URL } from "$env/static/public";
  import { jassubAssets } from "$lib/jassub-assets";
  import { exposeDocForDebug } from "$lib/debug-y";
  import { initPeaksController, type PeaksController } from "$lib/peaks-controller";
  import CueRow from "$lib/CueRow.svelte";
  import PresenceRoster from "$lib/PresenceRoster.svelte";
  import GlossaryPanel from "$lib/GlossaryPanel.svelte";
  import { matchingTermIds } from "$lib/glossary-match";
  import { fetchGlossary } from "$lib/glossary-api";
  import { userColor, derivePresence, type PresenceUser, type PresenceState } from "$lib/presence";
  import type { Cue } from "$lib/types";
  import type { GlossaryTerm } from "@subtitle-fm/shared";

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

  function setFocusedCue(id: string | null) {
    provider?.awareness?.setLocalStateField("focusedCueId", id);
    // Sticky: keep the badge anchored to the last focused cue while the user
    // interacts with the glossary panel. The awareness value still clears to null
    // on blur (presence stays accurate); only the local sticky id persists.
    if (id) focusedCueId = id;
  }

  // Click-to-fill: insert a glossary term's translation at the focused cue's
  // caret. Reuses the SFM-24 edit path — setRangeText mutates the textarea and
  // the synthetic 'input' event drives CueRow.handleTextInput -> onTextEdit ->
  // applyCueTextEdit. No-op if no cue textarea is focused. (The panel button's
  // onmousedown preventDefault keeps that textarea focused through the click.)
  // Known MVP edge: clicking mid-IME-composition can interleave the partial text
  // with the inserted term (CueRow gates onTextEdit on `composing`); rare, accepted.
  function insertTerm(targetText: string) {
    const el = document.activeElement;
    if (!(el instanceof HTMLTextAreaElement) || !el.classList.contains("cue-text")) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    el.setRangeText(targetText, start, end, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Initial paint from SSR REST data; Y.Doc takes over once connected.
  let cues = $state<LiveCue[]>(data.cues.map(restCueToLive));
  let connectionStatus = $state<"idle" | "connecting" | "connected" | "disconnected">("idle");
  let activeTab = $state<"video" | "waveform" | "cues" | "glossary">("cues");
  let roster = $state<PresenceUser[]>([]);
  let presenceByCue = $state<Map<string, PresenceUser[]>>(new Map());

  // Glossary: local $state so refetch (after add/edit/delete) updates the panel.
  let glossaryTerms = $state<GlossaryTerm[]>(data.glossaryTerms);
  // Sticky id of the last focused cue (set in setFocusedCue, never cleared on blur).
  let focusedCueId = $state<string | null>(null);
  const focusedCueText = $derived(cues.find((c) => c.id === focusedCueId)?.text ?? "");
  // Re-runs over all terms each keystroke (cues is reassigned wholesale by the Yjs
  // observer). Fine for small per-show glossaries.
  const matchedTermIds = $derived(matchingTermIds(focusedCueText, glossaryTerms));

  async function refreshGlossary() {
    try {
      glossaryTerms = await fetchGlossary(PUBLIC_API_URL, data.episode.showId);
    } catch {
      // Keep the current list on a transient refresh failure; editor stays usable.
    }
  }

  let publishing = $state(false);
  let publishMsg = $state<string | null>(null);
  const unreviewedCount = $derived(cues.filter((c) => c.needsReview).length);

  async function publish() {
    publishing = true;
    publishMsg = null;
    try {
      const res = await fetch(`${PUBLIC_API_URL}/episodes/${data.episode.id}/publish`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      publishMsg = res.ok
        ? `Published → ${(body as { key?: string }).key ?? "ok"}`
        : `Publish failed (${res.status}): ${(body as { error?: string }).error ?? "error"}`;
    } catch (e) {
      publishMsg = `Publish failed: ${(e as Error).message}`;
    } finally {
      publishing = false;
    }
  }

  const ready = $derived(data.episode.status === "ready_for_edit");
  const mediaUrl = $derived(data.episode.audioUrl);

  let provider: HocuspocusProvider | null = null;
  let videoEl: HTMLVideoElement | undefined = $state();
  let overviewEl: HTMLDivElement | undefined = $state();
  let zoomviewEl: HTMLDivElement | undefined = $state();
  let jassub: JASSUB | null = null;
  // $state (not a plain let): peaks is assigned asynchronously inside the
  // onMount IIFE, AFTER the cues $effect below has already run its first pass.
  // If peaks were a plain let, that first pass would hit `if (!peaks) return`
  // before reading `cues`, so the effect would never subscribe to cues and
  // live updates (cross-tab retime, needsReview colour) would silently stop.
  // As $state, the null→instance assignment re-triggers the effect; on the
  // re-run peaks is non-null, cues is read, and the subscription is established.
  let peaks = $state<PeaksController | null>(null);

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

    const awareness = provider.awareness;
    const sessionUser = data.session?.user;
    if (awareness && sessionUser) {
      awareness.setLocalStateField("user", {
        id: sessionUser.id,
        name: sessionUser.name,
        color: userColor(sessionUser.id),
      });
    }
    const updatePresence = () => {
      if (!awareness) return;
      const derived = derivePresence(
        awareness.getStates() as Map<number, PresenceState>,
        awareness.clientID,
      );
      roster = derived.roster;
      presenceByCue = derived.byCue;
    };
    if (awareness) {
      awareness.on("change", updatePresence);
      updatePresence();
    }

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
      if (awareness) {
        awareness.off("change", updatePresence);
        awareness.setLocalState(null);
      }
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

  // Sync cues into peaks.js. Re-runs when `peaks` flips null→instance (it's
  // $state) and on every `cues` change. The first pass (peaks still null,
  // before the async init resolves) reads `peaks`, returns early, and crucially
  // subscribes to `peaks`; the re-run after init reads `cues` and establishes
  // that subscription too, so all later cue edits reach the waveform.
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
      <button class:active={activeTab === "glossary"} onclick={() => (activeTab = "glossary")}>Glossary</button>
      <span class="conn">collab: {connectionStatus}</span>
      <button
        class="publish-btn"
        disabled={publishing || unreviewedCount > 0 || data.episode.status === "published"}
        title={unreviewedCount > 0 ? `${unreviewedCount} cue(s) need review` : "Publish the finalized .ass"}
        onclick={publish}
      >{publishing ? "Publishing…" : "Publish"}</button>
      {#if publishMsg}<span class="publish-msg">{publishMsg}</span>{/if}
    </nav>

    <section class="pane pane-video" class:tab-active={activeTab === "video"}>
      {#if mediaUrl}
        <video bind:this={videoEl} controls src={mediaUrl}></video>
      {:else}
        <p class="empty">No media URL on this episode.</p>
      {/if}
    </section>

    <section class="pane pane-cues" class:tab-active={activeTab === "cues"}>
      <PresenceRoster users={roster} />
      <ol
        class="cue-list"
        onfocusout={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
            setFocusedCue(null);
          }
        }}
      >
        {#each cues as cue (cue.id)}
          <CueRow
            {cue}
            remoteUsers={presenceByCue.get(cue.id) ?? []}
            onFocusCue={setFocusedCue}
            onTextEdit={(id, t) => {
              if (provider) applyCueTextEdit(provider.document, id, t);
            }}
            onRetime={(id, s, e) =>
              provider
                ? retimeCue(provider.document, id, s, e)
                : { ok: false, reason: "not-found" }}
            onClearReview={(id) => { if (provider) toggleCueNeedsReview(provider.document, id, false); }}
          />
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
    <section class="pane pane-glossary" class:tab-active={activeTab === "glossary"}>
      <GlossaryPanel
        terms={glossaryTerms}
        matchedIds={matchedTermIds}
        showId={data.episode.showId}
        onInsert={insertTerm}
        onChanged={refreshGlossary}
      />
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
      "waveform"
      "glossary";
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
  .publish-btn {
    padding: 0.35rem 0.75rem;
    cursor: pointer;
  }
  .publish-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .publish-msg {
    font-size: 0.8rem;
    color: #555;
    margin-left: 0.5rem;
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
  .pane-glossary {
    grid-area: glossary;
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
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 320px);
      grid-template-rows: 1fr auto;
      grid-template-areas:
        "video cues glossary"
        "waveform waveform glossary";
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
