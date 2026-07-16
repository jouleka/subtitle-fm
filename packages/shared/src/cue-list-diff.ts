import type { LiveCue } from './yjs';

/** ASS timestamps are centisecond-precise, so cue identity is rounded to 10 ms. */
export const CUE_IDENTITY_ROUND_MS = 10;

export const CUE_DIFF_FIELDS = [
  'orderIndex',
  'startMs',
  'endMs',
  'text',
  'styleName',
  'speakerId',
  'confidence',
  'needsReview',
] as const;

export type CueDiffField = (typeof CUE_DIFF_FIELDS)[number];
export type CueSideChange = 'unchanged' | 'added' | 'removed' | 'modified';
export type CueDiffKind = CueSideChange;

export interface CueListDiffRow {
  key: string;
  anchorMs: number;
  base: LiveCue | null;
  ours: LiveCue | null;
  theirs: LiveCue | null;
  oursChange: CueSideChange;
  theirsChange: CueSideChange;
  oursChangedFields: CueDiffField[];
  theirsChangedFields: CueDiffField[];
  kind: CueDiffKind;
  conflict: boolean;
}

export interface CueListDiffSummary {
  added: number;
  removed: number;
  modified: number;
  unchanged: number;
  conflicts: number;
}

export interface CueListDiff {
  rows: CueListDiffRow[];
  summary: CueListDiffSummary;
}

export interface CueListMergeResult {
  cues: LiveCue[];
  conflicts: CueListDiffRow[];
}

type Bucket = { base: LiveCue[]; ours: LiveCue[]; theirs: LiveCue[] };

function anchorFor(cue: LiveCue): number {
  return Math.round(cue.startMs / CUE_IDENTITY_ROUND_MS) * CUE_IDENTITY_ROUND_MS;
}

function sortBucket(cues: LiveCue[]): LiveCue[] {
  return [...cues].sort(
    (a, b) =>
      a.orderIndex - b.orderIndex ||
      a.endMs - b.endMs ||
      a.text.localeCompare(b.text) ||
      a.id.localeCompare(b.id),
  );
}

function changedFields(base: LiveCue | null, side: LiveCue | null): CueDiffField[] {
  if (!base || !side) return [];
  return CUE_DIFF_FIELDS.filter((field) => base[field] !== side[field]);
}

function sideChange(base: LiveCue | null, side: LiveCue | null): CueSideChange {
  if (!base && side) return 'added';
  if (base && !side) return 'removed';
  if (!base && !side) return 'unchanged';
  return changedFields(base, side).length > 0 ? 'modified' : 'unchanged';
}

function cuesEqual(left: LiveCue | null, right: LiveCue | null): boolean {
  if (!left || !right) return left === right;
  return CUE_DIFF_FIELDS.every((field) => left[field] === right[field]);
}

function overallKind(ours: CueSideChange, theirs: CueSideChange): CueDiffKind {
  if (ours === 'modified' || theirs === 'modified') return 'modified';
  if (ours === 'added' || theirs === 'added') return 'added';
  if (ours === 'removed' || theirs === 'removed') return 'removed';
  return 'unchanged';
}

function takeById(cues: LiveCue[], id: string): LiveCue | null {
  const index = cues.findIndex((cue) => cue.id === id);
  if (index < 0) return null;
  return cues.splice(index, 1)[0]!;
}

function rowsForBucket(anchorMs: number, bucket: Bucket): CueListDiffRow[] {
  const base = sortBucket(bucket.base);
  const ours = sortBucket(bucket.ours);
  const theirs = sortBucket(bucket.theirs);
  const sharedIds = new Set<string>();
  const idCounts = new Map<string, number>();
  for (const cue of [...base, ...ours, ...theirs]) {
    idCounts.set(cue.id, (idCounts.get(cue.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) if (count > 1) sharedIds.add(id);

  const triples: Array<[LiveCue | null, LiveCue | null, LiveCue | null]> = [];
  for (const id of [...sharedIds].sort()) {
    triples.push([takeById(base, id), takeById(ours, id), takeById(theirs, id)]);
  }
  const remaining = Math.max(base.length, ours.length, theirs.length);
  for (let index = 0; index < remaining; index += 1) {
    triples.push([base[index] ?? null, ours[index] ?? null, theirs[index] ?? null]);
  }

  return triples.map(([baseCue, oursCue, theirsCue], index) => {
    const oursChange = sideChange(baseCue, oursCue);
    const theirsChange = sideChange(baseCue, theirsCue);
    return {
      key: `${anchorMs}:${index}`,
      anchorMs,
      base: baseCue,
      ours: oursCue,
      theirs: theirsCue,
      oursChange,
      theirsChange,
      oursChangedFields: changedFields(baseCue, oursCue),
      theirsChangedFields: changedFields(baseCue, theirsCue),
      kind: overallKind(oursChange, theirsChange),
      conflict:
        oursChange !== 'unchanged' &&
        theirsChange !== 'unchanged' &&
        !cuesEqual(oursCue, theirsCue),
    };
  });
}

/**
 * Compare three cue-list snapshots using rounded start time as the stable cue
 * identity. Cue ids only disambiguate collisions inside one rounded bucket.
 */
export function threeWayCueListDiff(
  baseCues: LiveCue[],
  oursCues: LiveCue[],
  theirsCues: LiveCue[],
): CueListDiff {
  const buckets = new Map<number, Bucket>();
  const add = (side: keyof Bucket, cue: LiveCue) => {
    const anchor = anchorFor(cue);
    const bucket = buckets.get(anchor) ?? { base: [], ours: [], theirs: [] };
    bucket[side].push(cue);
    buckets.set(anchor, bucket);
  };
  for (const cue of baseCues) add('base', cue);
  for (const cue of oursCues) add('ours', cue);
  for (const cue of theirsCues) add('theirs', cue);

  const rows = [...buckets.keys()]
    .sort((a, b) => a - b)
    .flatMap((anchor) => rowsForBucket(anchor, buckets.get(anchor)!));
  const summary: CueListDiffSummary = {
    added: 0,
    removed: 0,
    modified: 0,
    unchanged: 0,
    conflicts: 0,
  };
  for (const row of rows) {
    summary[row.kind] += 1;
    if (row.conflict) summary.conflicts += 1;
  }
  return { rows, summary };
}

/** Apply non-conflicting branch changes (`theirs`) on top of live (`ours`). */
export function mergeCueLists(
  baseCues: LiveCue[],
  oursCues: LiveCue[],
  theirsCues: LiveCue[],
): CueListMergeResult {
  const diff = threeWayCueListDiff(baseCues, oursCues, theirsCues);
  const conflicts = diff.rows.filter((row) => row.conflict);
  if (conflicts.length > 0) return { cues: [], conflicts };

  const selected = diff.rows
    .map((row) => (row.theirsChange !== 'unchanged' ? row.theirs : row.ours))
    .filter((cue): cue is LiveCue => cue !== null)
    .sort((left, right) => left.startMs - right.startMs || left.orderIndex - right.orderIndex)
    .map((cue, orderIndex) => ({ ...cue, orderIndex }));
  return { cues: selected, conflicts: [] };
}
