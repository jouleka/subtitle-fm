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
 * an explicit sort. If two entries with the same `id` appear in the array (CRDT-merge edge case), the first match wins and the rest are ignored.
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

export interface TextDiff {
  /** Index in oldText where the change begins. */
  index: number;
  /** Number of chars to delete from oldText starting at index. */
  deleteCount: number;
  /** String to insert at index (after the deletion). */
  insert: string;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Minimal single-span diff via common prefix + suffix. Produces the smallest
 * contiguous (delete, insert) that turns oldText into newText — enough for a
 * keystroke-granularity Y.Text edit without rewriting the whole string. A
 * no-op edit returns { index: 0, deleteCount: 0, insert: "" }.
 *
 * Boundaries are snapped off surrogate-pair midpoints: JS/Y.Text index by
 * UTF-16 code unit, so a diff that split a pair (e.g. 😀→😁, which share a
 * high surrogate) would write a lone surrogate and corrupt the Y.Text. When a
 * boundary lands mid-pair we back it up so the whole code point is diffed.
 */
export function computeTextDiff(oldText: string, newText: string): TextDiff {
  if (oldText === newText) return { index: 0, deleteCount: 0, insert: "" };

  const minLen = Math.min(oldText.length, newText.length);

  let prefix = 0;
  while (prefix < minLen && oldText[prefix] === newText[prefix]) prefix++;
  // If the prefix ends just after a high surrogate, its low half is the first
  // differing unit — back up so the whole pair is inside the diff.
  if (prefix > 0 && isHighSurrogate(oldText.charCodeAt(prefix - 1))) prefix--;

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }
  // If the suffix begins on a low surrogate, its high half is the last
  // differing unit — back up so the whole pair is inside the diff.
  if (suffix > 0 && isLowSurrogate(oldText.charCodeAt(oldText.length - suffix))) suffix--;

  return {
    index: prefix,
    deleteCount: oldText.length - prefix - suffix,
    insert: newText.slice(prefix, newText.length - suffix),
  };
}

/**
 * Apply a text edit to a cue's Y.Text using the minimal diff, inside one
 * transaction tagged "sfm-24-text". Returns false (no write) if the cue is
 * missing or the text is unchanged. Mutates the EXISTING Y.Text in place
 * (insert/delete) — never replaces it — so collaborative merging is preserved.
 */
export function applyCueTextEdit(doc: Y.Doc, cueId: string, newText: string): boolean {
  let changed = false;

  doc.transact(() => {
    const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);
    let target: Y.Map<unknown> | undefined;
    for (let i = 0; i < yArr.length; i++) {
      if ((yArr.get(i)?.get("id") as string | undefined) === cueId) {
        target = yArr.get(i);
        break;
      }
    }
    if (!target) return;

    const yText = target.get("text") as Y.Text | undefined;
    if (!yText) return;

    const diff = computeTextDiff(yText.toString(), newText);
    if (diff.deleteCount === 0 && diff.insert.length === 0) return;

    if (diff.deleteCount > 0) yText.delete(diff.index, diff.deleteCount);
    if (diff.insert.length > 0) yText.insert(diff.index, diff.insert);
    changed = true;
  }, "sfm-24-text");

  return changed;
}

/**
 * Set needsReview on a cue inside one transaction tagged "sfm-29-review".
 * Returns false (no write) if the cue is missing or already at `value`.
 */
export function toggleCueNeedsReview(doc: Y.Doc, cueId: string, value: boolean): boolean {
  let changed = false;
  doc.transact(() => {
    const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);
    for (let i = 0; i < yArr.length; i++) {
      const m = yArr.get(i);
      if ((m?.get("id") as string | undefined) === cueId) {
        if (Boolean(m!.get("needsReview")) !== value) {
          m!.set("needsReview", value);
          changed = true;
        }
        break;
      }
    }
  }, "sfm-29-review");
  return changed;
}

// Keep orderIndex == array index after a structural mutation. The change-guard skips
// the unchanged prefix, but an insert/move shifts the entire tail, so this rewrites
// O(tail-length) orderIndex fields per op — accepted (cue counts are modest).
function renumberOrderIndex(yArr: Y.Array<Y.Map<unknown>>): void {
  for (let i = 0; i < yArr.length; i++) {
    const m = yArr.get(i);
    if ((m?.get("orderIndex") as number | undefined) !== i) m!.set("orderIndex", i);
  }
}

export type SplitResult =
  | { ok: true; newCueId: string }
  | { ok: false; reason: "not-found" | "empty-half" | "too-short" };

/**
 * Split a cue at the caret into two non-empty cues inside one transaction
 * ("sfm-51-split"). Time divides proportionally to the caret, clamped so each
 * half is >= MIN_CUE_DURATION_MS. The new (second) half inherits needsReview so a
 * review-flagged cue can't be split past the publish gate.
 */
export function splitCue(doc: Y.Doc, cueId: string, caretOffset: number): SplitResult {
  let result: SplitResult = { ok: false, reason: "not-found" };

  doc.transact(() => {
    const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);

    let idx = -1;
    for (let i = 0; i < yArr.length; i++) {
      if ((yArr.get(i)?.get("id") as string | undefined) === cueId) { idx = i; break; }
    }
    if (idx < 0) { result = { ok: false, reason: "not-found" }; return; }

    const target = yArr.get(idx)!;
    const yText = target.get("text") as Y.Text | undefined;
    if (!yText) { result = { ok: false, reason: "not-found" }; return; }

    const full = yText.toString();
    const len = full.length;

    let cut = Math.max(0, Math.min(len, Math.floor(caretOffset)));
    if (cut > 0 && cut < len && isLowSurrogate(full.charCodeAt(cut)) && isHighSurrogate(full.charCodeAt(cut - 1))) {
      cut -= 1;
    }
    if (cut <= 0 || cut >= len) { result = { ok: false, reason: "empty-half" }; return; }

    const startMs = target.get("startMs") as number;
    const endMs = target.get("endMs") as number;
    const dur = endMs - startMs;
    if (dur < 2 * MIN_CUE_DURATION_MS) { result = { ok: false, reason: "too-short" }; return; }

    const rawBoundary = startMs + Math.round((dur * cut) / len);
    const boundary = Math.max(startMs + MIN_CUE_DURATION_MS, Math.min(endMs - MIN_CUE_DURATION_MS, rawBoundary));

    const postText = full.slice(cut);

    const newId = crypto.randomUUID();
    // MUST mirror every cue field cueMapToLive reads — adding a cue field requires updating this.
    const newMap = new Y.Map<unknown>();
    newMap.set("id", newId);
    newMap.set("orderIndex", idx + 1);
    newMap.set("startMs", boundary);
    newMap.set("endMs", endMs);
    newMap.set("rawOverrideTags", "");
    newMap.set("styleName", (target.get("styleName") as string | undefined) ?? "Default");
    newMap.set("speakerId", (target.get("speakerId") as string | null | undefined) ?? null);
    newMap.set("confidence", null);
    newMap.set("needsReview", Boolean(target.get("needsReview")));
    const newText = new Y.Text();
    newText.insert(0, postText);
    newMap.set("text", newText);

    yText.delete(cut, len - cut);
    target.set("endMs", boundary);
    yArr.insert(idx + 1, [newMap]);
    renumberOrderIndex(yArr);

    result = { ok: true, newCueId: newId };
  }, "sfm-51-split");

  return result;
}

export type MoveResult = { ok: true } | { ok: false; reason: "not-found" | "edge" };

function cloneCueMap(src: Y.Map<unknown>): Y.Map<unknown> {
  // MUST mirror every cue field cueMapToLive reads — adding a cue field requires updating this.
  const m = new Y.Map<unknown>();
  m.set("id", src.get("id"));
  m.set("orderIndex", src.get("orderIndex"));
  m.set("startMs", src.get("startMs"));
  m.set("endMs", src.get("endMs"));
  m.set("rawOverrideTags", (src.get("rawOverrideTags") as string | undefined) ?? "");
  m.set("styleName", (src.get("styleName") as string | undefined) ?? "Default");
  m.set("speakerId", (src.get("speakerId") as string | null | undefined) ?? null);
  m.set("confidence", (src.get("confidence") as number | null | undefined) ?? null);
  m.set("needsReview", Boolean(src.get("needsReview")));
  const srcText = src.get("text") as Y.Text | undefined;
  const t = new Y.Text();
  t.insert(0, srcText ? srcText.toString() : "");
  m.set("text", t);
  return m;
}

/**
 * Reorder a cue up/down by one position inside one transaction ("sfm-51-move").
 * Y.Array has no atomic move, so we delete the Y.Map and reinsert a clone (fresh
 * Y.Text from its string), keeping the cue id. Position-move: the cue keeps its
 * time and changes list position; orderIndex is renumbered to array index.
 */
export function moveCue(doc: Y.Doc, cueId: string, direction: "up" | "down"): MoveResult {
  let result: MoveResult = { ok: false, reason: "not-found" };

  doc.transact(() => {
    const yArr = doc.getArray<Y.Map<unknown>>(CUES_ARRAY_KEY);

    let idx = -1;
    for (let i = 0; i < yArr.length; i++) {
      if ((yArr.get(i)?.get("id") as string | undefined) === cueId) { idx = i; break; }
    }
    if (idx < 0) { result = { ok: false, reason: "not-found" }; return; }

    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= yArr.length) { result = { ok: false, reason: "edge" }; return; }

    const clone = cloneCueMap(yArr.get(idx)!);
    yArr.delete(idx, 1);
    yArr.insert(newIdx, [clone]);
    renumberOrderIndex(yArr);

    result = { ok: true };
  }, "sfm-51-move");

  return result;
}

/**
 * Decode a stored Y.Doc update (snapshots.yjsState bytes) into LiveCue[] — the
 * authoritative cue state for server-side publish.
 */
export function liveCuesFromSnapshot(yjsState: Uint8Array): LiveCue[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yjsState);
  return liveCuesFromDoc(doc);
}
