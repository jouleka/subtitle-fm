import type { PeaksInstance, SegmentDragEvent, SegmentOptions } from "peaks.js";
import type { LiveCue } from "@subtitle-fm/shared/yjs";

// Matches the cue-list .needs-review border + .badge background in
// apps/web/src/routes/episodes/[id]/edit/+page.svelte. Keep in sync.
const NEEDS_REVIEW_COLOR = "#f4b400";
const DEFAULT_COLOR = "#5e95d6";

export interface CueInput {
  id: string;
  startMs: number;
  endMs: number;
  needsReview: boolean;
}

// Snapshot of a peaks.js segment's rendered props, used to diff against the
// wanted cues. peaks.js may emit transient segments without ids during a
// drag; those are ignored (we only own cue-keyed segments). startTime/endTime
// are in seconds (peaks.js's native unit).
export interface SegmentSnapshot {
  id?: string;
  startTime?: number;
  endTime?: number;
  color?: string;
}

export interface SegmentAddInput {
  id: string;
  startTime: number;
  endTime: number;
  editable: boolean;
  color: string;
  labelText: string;
}

export interface CueDiff {
  adds: SegmentAddInput[];
  removes: string[];
}

export interface PeaksControllerInitOptions {
  overviewEl: HTMLDivElement;
  zoomviewEl: HTMLDivElement;
  mediaElement: HTMLMediaElement;
  peaksUrl: string;
  onCueRetime: (cueId: string, startMs: number, endMs: number) => void;
}

export interface PeaksController {
  setCues(cues: LiveCue[]): void;
  destroy(): void;
}

function cueColor(needsReview: boolean): string {
  return needsReview ? NEEDS_REVIEW_COLOR : DEFAULT_COLOR;
}

function cueToAdd(cue: CueInput): SegmentAddInput {
  return {
    id: cue.id,
    startTime: cue.startMs / 1000,
    endTime: cue.endMs / 1000,
    editable: true,
    color: cueColor(cue.needsReview),
    labelText: "",
  };
}

// True when the rendered segment no longer matches the cue. Compared in
// integer milliseconds to dodge float drift from the seconds round-trip.
function segmentDiffers(seg: SegmentSnapshot, cue: CueInput): boolean {
  return (
    Math.round((seg.startTime ?? -1) * 1000) !== cue.startMs ||
    Math.round((seg.endTime ?? -1) * 1000) !== cue.endMs ||
    seg.color !== cueColor(cue.needsReview)
  );
}

/**
 * Pure diff between the segments peaks.js currently owns and the cues the
 * editor wants displayed. Exported so unit tests can exercise it against
 * plain objects without instantiating a real Peaks instance.
 *
 * Changed segments are emitted as a remove + a re-add rather than an update:
 * peaks.js v3's Segment.update() mutates the segment's data but does not
 * repaint the rendered shape (its waveform sceneFunc isn't re-run by Konva's
 * autoDraw on a plain attribute change). A remove + add is a structural
 * change Konva does honour, so the new colour / position actually paints.
 * Unchanged segments are left untouched so re-renders don't flicker.
 *
 * Current segments without an id are ignored (transient drag segments).
 * Callers must guarantee unique ids in `wanted`; duplicates collapse to the
 * last entry via Map semantics.
 */
export function diffCueSegments(current: SegmentSnapshot[], wanted: CueInput[]): CueDiff {
  const currentById = new Map<string, SegmentSnapshot>();
  for (const seg of current) {
    if (typeof seg.id === "string") currentById.set(seg.id, seg);
  }
  const wantedById = new Map(wanted.map((c) => [c.id, c]));

  const removes: string[] = [];
  for (const [id, seg] of currentById) {
    const cue = wantedById.get(id);
    if (!cue || segmentDiffers(seg, cue)) removes.push(id);
  }

  const adds: SegmentAddInput[] = [];
  for (const cue of wanted) {
    const seg = currentById.get(cue.id);
    if (!seg || segmentDiffers(seg, cue)) adds.push(cueToAdd(cue));
  }

  return { adds, removes };
}

/**
 * Construct a PeaksController from a real peaks.js instance. The init is
 * async because Peaks.init uses a Node-style callback; we wrap it in a
 * Promise so the caller can await mounting. Not directly unit-tested —
 * the testable seam is diffCueSegments, which setCues delegates to.
 */
export async function initPeaksController(
  opts: PeaksControllerInitOptions,
): Promise<PeaksController> {
  const { default: Peaks } = await import("peaks.js");
  const peaks = await new Promise<PeaksInstance>((resolve, reject) => {
    Peaks.init(
      {
        zoomview: { container: opts.zoomviewEl },
        overview: { container: opts.overviewEl },
        mediaElement: opts.mediaElement,
        dataUri: { arraybuffer: opts.peaksUrl },
      } as Parameters<typeof Peaks.init>[0],
      (err, instance) => {
        if (err || !instance) {
          reject(err ?? new Error("peaks.js init returned null without error"));
          return;
        }
        resolve(instance);
      },
    );
  });

  peaks.on("segments.dragend", (event: SegmentDragEvent) => {
    if (!event.segment.id) return;
    opts.onCueRetime(
      event.segment.id,
      Math.round(event.segment.startTime * 1000),
      Math.round(event.segment.endTime * 1000),
    );
  });

  function setCues(cues: LiveCue[]): void {
    const current: SegmentSnapshot[] = peaks.segments.getSegments().map((s) => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      // We only ever set string colours; a non-string (gradient) reads as
      // undefined, which segmentDiffers treats as changed → safe re-add.
      color: typeof s.color === "string" ? s.color : undefined,
    }));
    const wanted: CueInput[] = cues.map((c) => ({
      id: c.id,
      startMs: c.startMs,
      endMs: c.endMs,
      needsReview: c.needsReview,
    }));
    const diff = diffCueSegments(current, wanted);

    for (const id of diff.removes) peaks.segments.removeById(id);
    for (const add of diff.adds) peaks.segments.add(add as SegmentOptions);
  }

  return {
    setCues,
    destroy: () => peaks.destroy(),
  };
}

/**
 * Whether a failed peaks.js init should be reset + retried (SFM-50). The only
 * retryable failure is the visibility race: peaks.js re-checks container
 * visibility AFTER its async data XHR, so leaving the Waveform tab mid-load
 * makes init throw with the container now hidden. A failure while the container
 * is still visible is non-transient (bad .dat / network) and must NOT retry
 * (would loop on every tab toggle). Capped to bound a pathological hide loop.
 */
export function peaksInitShouldRetry(
  containerHidden: boolean,
  retries: number,
  maxRetries: number,
): boolean {
  return containerHidden && retries < maxRetries;
}
