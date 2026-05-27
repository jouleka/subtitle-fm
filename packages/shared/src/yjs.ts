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
