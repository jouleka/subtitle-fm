import { segmentOverrideTags, type Segment } from './override-tags';
import type { RemoteCaret } from './presence';

export type CaretDecoratedSegment = Segment | { kind: 'caret'; caret: RemoteCaret };

function displaySafeOffset(text: string, rawOffset: number): number {
  let offset = Math.max(0, Math.min(text.length, Math.floor(rawOffset)));
  if (
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[offset]!)
  ) {
    offset += 1;
  }
  return offset;
}

/**
 * Insert zero-width caret tokens into the existing ASS-highlight segments.
 * Textarea selection offsets and String.slice both use UTF-16 code units. A
 * stale offset that lands inside a surrogate pair is snapped past the pair so
 * decorating the mirror can never split an emoji into replacement glyphs.
 */
export function decorateWithRemoteCarets(
  text: string,
  carets: RemoteCaret[],
): CaretDecoratedSegment[] {
  const byOffset = new Map<number, RemoteCaret[]>();
  for (const caret of carets) {
    const offset = displaySafeOffset(text, caret.head);
    const atOffset = byOffset.get(offset) ?? [];
    atOffset.push(caret);
    byOffset.set(offset, atOffset);
  }
  for (const atOffset of byOffset.values()) {
    atOffset.sort((a, b) => a.clientId - b.clientId);
  }
  const offsets = [...byOffset.keys()].sort((a, b) => a - b);

  const out: CaretDecoratedSegment[] = [];
  const emitCarets = (offset: number) => {
    for (const caret of byOffset.get(offset) ?? []) {
      out.push({ kind: 'caret', caret });
    }
  };

  let absoluteStart = 0;
  for (const segment of segmentOverrideTags(text)) {
    const absoluteEnd = absoluteStart + segment.value.length;
    emitCarets(absoluteStart);

    let partStart = absoluteStart;
    for (const offset of offsets) {
      if (offset <= absoluteStart || offset >= absoluteEnd) continue;
      out.push({ kind: segment.kind, value: text.slice(partStart, offset) });
      emitCarets(offset);
      partStart = offset;
    }
    if (partStart < absoluteEnd) {
      out.push({ kind: segment.kind, value: text.slice(partStart, absoluteEnd) });
    }
    absoluteStart = absoluteEnd;
  }
  emitCarets(text.length);
  return out;
}
