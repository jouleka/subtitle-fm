import type { PeaksInstance, SegmentDragEvent } from "peaks.js";
import type { LiveCue } from "@subtitle-fm/shared/yjs";

const NEEDS_REVIEW_COLOR = "#f4b400";
const DEFAULT_COLOR = "#5e95d6";

export interface CueInput {
  id: string;
  startMs: number;
  endMs: number;
  needsReview: boolean;
}

interface SegmentLike {
  id?: string;
}

export interface SegmentAddInput {
  id: string;
  startTime: number;
  endTime: number;
  editable: boolean;
  color: string;
  labelText: string;
}

export interface SegmentUpdateProps {
  startTime: number;
  endTime: number;
  color: string;
}

export interface CueDiff {
  adds: SegmentAddInput[];
  updates: { id: string; props: SegmentUpdateProps }[];
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

function cueToUpdate(cue: CueInput): SegmentUpdateProps {
  return {
    startTime: cue.startMs / 1000,
    endTime: cue.endMs / 1000,
    color: cueColor(cue.needsReview),
  };
}

/**
 * Pure diff between the segments peaks.js currently owns and the cues the
 * editor wants displayed. Exported so unit tests can exercise it against
 * plain objects without instantiating a real Peaks instance.
 *
 * Current segments without an id are ignored — peaks.js may emit
 * transient segments during a drag that we don't own.
 */
export function diffCueSegments(current: SegmentLike[], wanted: CueInput[]): CueDiff {
  const wantedById = new Map(wanted.map((c) => [c.id, c]));
  const currentIds = new Set(
    current.map((s) => s.id).filter((id): id is string => typeof id === "string"),
  );

  const removes: string[] = [];
  for (const id of currentIds) {
    if (!wantedById.has(id)) removes.push(id);
  }

  const adds: SegmentAddInput[] = [];
  const updates: { id: string; props: SegmentUpdateProps }[] = [];
  for (const cue of wanted) {
    if (currentIds.has(cue.id)) {
      updates.push({ id: cue.id, props: cueToUpdate(cue) });
    } else {
      adds.push(cueToAdd(cue));
    }
  }

  return { adds, updates, removes };
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
    const current = peaks.segments.getSegments() as SegmentLike[];
    const wanted: CueInput[] = cues.map((c) => ({
      id: c.id,
      startMs: c.startMs,
      endMs: c.endMs,
      needsReview: c.needsReview,
    }));
    const diff = diffCueSegments(current, wanted);

    for (const id of diff.removes) peaks.segments.removeById(id);
    for (const add of diff.adds) peaks.segments.add(add as import("peaks.js").SegmentOptions);
    for (const { id, props } of diff.updates) {
      const seg = peaks.segments.getSegment(id);
      seg?.update(props as import("peaks.js").SegmentOptions);
    }
  }

  return {
    setCues,
    destroy: () => peaks.destroy(),
  };
}
