export type TextDiffKind = 'equal' | 'insert' | 'delete';

export interface TextDiffSegment {
  kind: TextDiffKind;
  text: string;
  conflict: boolean;
}

export interface TextConflict {
  baseStart: number;
  baseEnd: number;
  baseText: string;
  oursText: string;
  theirsText: string;
}

export interface ThreeWayTextDiff {
  ours: TextDiffSegment[];
  theirs: TextDiffSegment[];
  conflicts: TextConflict[];
}

type InternalSegment = TextDiffSegment & { editIndex: number | null };
type Edit = {
  baseStart: number;
  baseEnd: number;
  replacement: string;
};

function tokenize(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu) ?? [];
}

function appendSegment(
  segments: InternalSegment[],
  kind: TextDiffKind,
  token: string,
  editIndex: number | null,
): void {
  const previous = segments[segments.length - 1];
  if (previous?.kind === kind && previous.editIndex === editIndex) previous.text += token;
  else segments.push({ kind, text: token, conflict: false, editIndex });
}

function buildDiff(
  baseText: string,
  nextText: string,
): {
  baseTokens: string[];
  segments: InternalSegment[];
  edits: Edit[];
} {
  const base = tokenize(baseText);
  const next = tokenize(nextText);
  const lcs = Array.from({ length: base.length + 1 }, () => new Uint16Array(next.length + 1));
  for (let i = base.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        base[i] === next[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const segments: InternalSegment[] = [];
  const edits: Edit[] = [];
  let baseIndex = 0;
  let nextIndex = 0;
  while (baseIndex < base.length || nextIndex < next.length) {
    if (baseIndex < base.length && nextIndex < next.length && base[baseIndex] === next[nextIndex]) {
      appendSegment(segments, 'equal', base[baseIndex]!, null);
      baseIndex += 1;
      nextIndex += 1;
      continue;
    }

    const editIndex = edits.length;
    const baseStart = baseIndex;
    let replacement = '';
    while (
      (baseIndex < base.length || nextIndex < next.length) &&
      !(baseIndex < base.length && nextIndex < next.length && base[baseIndex] === next[nextIndex])
    ) {
      const deleteWins =
        baseIndex < base.length &&
        (nextIndex >= next.length ||
          lcs[baseIndex + 1]![nextIndex]! >= lcs[baseIndex]![nextIndex + 1]!);
      if (deleteWins) {
        appendSegment(segments, 'delete', base[baseIndex]!, editIndex);
        baseIndex += 1;
      } else {
        const token = next[nextIndex]!;
        appendSegment(segments, 'insert', token, editIndex);
        replacement += token;
        nextIndex += 1;
      }
    }
    edits.push({ baseStart, baseEnd: baseIndex, replacement });
  }
  return { baseTokens: base, segments, edits };
}

function editsOverlap(left: Edit, right: Edit): boolean {
  const leftInsertion = left.baseStart === left.baseEnd;
  const rightInsertion = right.baseStart === right.baseEnd;
  if (leftInsertion && rightInsertion) return left.baseStart === right.baseStart;
  if (leftInsertion) return left.baseStart > right.baseStart && left.baseStart < right.baseEnd;
  if (rightInsertion) return right.baseStart > left.baseStart && right.baseStart < left.baseEnd;
  return Math.max(left.baseStart, right.baseStart) < Math.min(left.baseEnd, right.baseEnd);
}

function sameEdit(left: Edit, right: Edit): boolean {
  return (
    left.baseStart === right.baseStart &&
    left.baseEnd === right.baseEnd &&
    left.replacement === right.replacement
  );
}

function publicSegments(
  segments: InternalSegment[],
  conflictingEdits: Set<number>,
): TextDiffSegment[] {
  return segments.map(({ kind, text, editIndex }) => ({
    kind,
    text,
    conflict: editIndex !== null && conflictingEdits.has(editIndex),
  }));
}

/** Word/punctuation diff from base to one edited cue, preserving whitespace. */
export function wordTextDiff(baseText: string, nextText: string): TextDiffSegment[] {
  return publicSegments(buildDiff(baseText, nextText).segments, new Set());
}

/**
 * Diff both variants against one base and mark only overlapping, divergent
 * edit ranges as conflicts. Equal edits made independently are not conflicts.
 */
export function threeWayTextDiff(
  baseText: string,
  oursText: string,
  theirsText: string,
): ThreeWayTextDiff {
  const ours = buildDiff(baseText, oursText);
  const theirs = buildDiff(baseText, theirsText);
  const oursConflicts = new Set<number>();
  const theirsConflicts = new Set<number>();
  const conflicts: TextConflict[] = [];

  for (let oursIndex = 0; oursIndex < ours.edits.length; oursIndex += 1) {
    const oursEdit = ours.edits[oursIndex]!;
    for (let theirsIndex = 0; theirsIndex < theirs.edits.length; theirsIndex += 1) {
      const theirsEdit = theirs.edits[theirsIndex]!;
      if (!editsOverlap(oursEdit, theirsEdit) || sameEdit(oursEdit, theirsEdit)) continue;
      oursConflicts.add(oursIndex);
      theirsConflicts.add(theirsIndex);
      const baseStart = Math.min(oursEdit.baseStart, theirsEdit.baseStart);
      const baseEnd = Math.max(oursEdit.baseEnd, theirsEdit.baseEnd);
      conflicts.push({
        baseStart,
        baseEnd,
        baseText: ours.baseTokens.slice(baseStart, baseEnd).join(''),
        oursText: oursEdit.replacement,
        theirsText: theirsEdit.replacement,
      });
    }
  }

  return {
    ours: publicSegments(ours.segments, oursConflicts),
    theirs: publicSegments(theirs.segments, theirsConflicts),
    conflicts,
  };
}
