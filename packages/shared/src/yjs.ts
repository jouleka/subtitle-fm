import * as Y from "yjs";

export const CUES_ARRAY_KEY = "cues" as const;

/** Plain shape derived from a Y.Map cue, suitable for display. */
export interface LiveCue {
  id: string;
  orderIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  rawOverrideTags: string;
  styleName: string;
  speakerId: string | null;
  confidence: number | null;
  needsReview: boolean;
}

/** Subset of DB row fields the Y.Doc hydrates from. */
export interface CueSeed {
  id: string;
  orderIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  rawOverrideTags: string;
  styleName: string;
  speakerId: string | null;
  confidence: number | null;
  needsReview: boolean;
}

/**
 * Hydrate a fresh Y.Doc with cue seeds. No-op if the doc already has cues.
 * Groups all inserts into one transaction so clients see hydration as one update.
 */
export function hydrateCuesIntoDoc(doc: Y.Doc, seeds: CueSeed[]): void {
  doc.transact(() => {
    const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);
    if (yArr.length > 0) return;
    for (const seed of seeds) {
      yArr.push([cueSeedToYMap(seed)]);
    }
  });
}

function cueSeedToYMap(seed: CueSeed): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  m.set("id", seed.id);
  m.set("orderIndex", seed.orderIndex);
  m.set("startMs", seed.startMs);
  m.set("endMs", seed.endMs);
  m.set("rawOverrideTags", seed.rawOverrideTags);
  m.set("styleName", seed.styleName);
  m.set("speakerId", seed.speakerId);
  m.set("confidence", seed.confidence);
  m.set("needsReview", seed.needsReview);
  const text = new Y.Text();
  text.insert(0, seed.text);
  m.set("text", text);
  return m;
}

export function cueMapToLive(map: Y.Map<unknown>): LiveCue {
  const text = map.get("text") as Y.Text | undefined;
  return {
    id: map.get("id") as string,
    orderIndex: map.get("orderIndex") as number,
    startMs: map.get("startMs") as number,
    endMs: map.get("endMs") as number,
    text: text ? text.toString() : "",
    rawOverrideTags: (map.get("rawOverrideTags") as string | undefined) ?? "",
    styleName: (map.get("styleName") as string | undefined) ?? "Default",
    speakerId: (map.get("speakerId") as string | null | undefined) ?? null,
    confidence: (map.get("confidence") as number | null | undefined) ?? null,
    needsReview: Boolean(map.get("needsReview")),
  };
}

export function liveCuesFromDoc(doc: Y.Doc): LiveCue[] {
  const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);
  return yArr.map(cueMapToLive);
}

export const MIN_CUE_DURATION_MS = 100;

export type RetimeResult =
  | { ok: true; startMs: number; endMs: number }
  | { ok: false; reason: "not-found" | "invalid-range" };

/**
 * Atomically retime a cue's start/end. Looks up by id in the CUES_ARRAY_KEY
 * array, clamps the requested range against array-adjacent neighbours, and
 * writes inside one transaction tagged "sfm-23-retime".
 *
 * Invariants enforced inside the transaction:
 *   - prev.endMs <= startMs < endMs <= next.startMs
 *   - endMs - startMs >= MIN_CUE_DURATION_MS
 *
 * If clamping would violate the minimum duration, the function returns
 * { ok: false, reason: "invalid-range" } without writing. Callers are
 * responsible for reverting any local UI state to match (e.g. the
 * peaks-controller re-applies setCues from the unchanged doc).
 *
 * Assumes cues are stored in orderIndex order in the Y.Array — which
 * hydrateCuesIntoDoc guarantees and the editor never violates without
 * an explicit sort.
 */
export function retimeCue(
  doc: Y.Doc,
  cueId: string,
  requestedStartMs: number,
  requestedEndMs: number,
): RetimeResult {
  let result: RetimeResult = { ok: false, reason: "not-found" };

  doc.transact(() => {
    const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);

    let targetIndex = -1;
    for (let i = 0; i < yArr.length; i++) {
      if ((yArr.get(i)?.get("id") as string | undefined) === cueId) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex < 0) {
      result = { ok: false, reason: "not-found" };
      return;
    }

    const target = yArr.get(targetIndex)!;
    const prev = targetIndex > 0 ? yArr.get(targetIndex - 1) : undefined;
    const next = targetIndex < yArr.length - 1 ? yArr.get(targetIndex + 1) : undefined;

    const prevEnd = (prev?.get("endMs") as number | undefined) ?? 0;
    const nextStart = (next?.get("startMs") as number | undefined) ?? Number.MAX_SAFE_INTEGER;

    const startMs = Math.max(prevEnd, Math.floor(requestedStartMs));
    const endMs = Math.min(nextStart, Math.floor(requestedEndMs));

    if (endMs - startMs < MIN_CUE_DURATION_MS) {
      result = { ok: false, reason: "invalid-range" };
      return;
    }

    target.set("startMs", startMs);
    target.set("endMs", endMs);
    result = { ok: true, startMs, endMs };
  }, "sfm-23-retime");

  return result;
}
