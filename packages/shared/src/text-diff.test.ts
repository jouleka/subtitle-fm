import { describe, expect, test } from 'bun:test';
import { threeWayTextDiff, wordTextDiff } from './text-diff';

describe('wordTextDiff (SFM-38)', () => {
  test('highlights a word insertion while preserving whitespace and punctuation', () => {
    expect(wordTextDiff('We made it.', 'We finally made it.')).toEqual([
      { kind: 'equal', text: 'We ', conflict: false },
      { kind: 'insert', text: 'finally ', conflict: false },
      { kind: 'equal', text: 'made it.', conflict: false },
    ]);
  });

  test('represents a replacement as deletion plus insertion', () => {
    expect(wordTextDiff('red fox', 'blue fox')).toEqual([
      { kind: 'delete', text: 'red', conflict: false },
      { kind: 'insert', text: 'blue', conflict: false },
      { kind: 'equal', text: ' fox', conflict: false },
    ]);
  });

  test('keeps emoji and ASS punctuation intact', () => {
    const segments = wordTextDiff('{\\i1}Hi 😀', '{\\i1}Hello 😀');
    expect(segments.map((segment) => segment.text).join('')).toBe('{\\i1}HiHello 😀');
    expect(
      segments.filter((segment) => segment.kind !== 'equal').map((segment) => segment.text),
    ).toEqual(['Hi', 'Hello']);
  });
});

describe('threeWayTextDiff (SFM-38)', () => {
  test('marks divergent insertions at the same word boundary as a conflict', () => {
    const diff = threeWayTextDiff('We made it.', 'We finally made it.', 'We barely made it.');
    expect(diff.conflicts).toHaveLength(1);
    expect(diff.ours.find((segment) => segment.kind === 'insert')).toMatchObject({
      text: 'finally ',
      conflict: true,
    });
    expect(diff.theirs.find((segment) => segment.kind === 'insert')).toMatchObject({
      text: 'barely ',
      conflict: true,
    });
  });

  test('does not conflict when the two sides edit different base words', () => {
    const diff = threeWayTextDiff('The red fox jumps', 'The blue fox jumps', 'The red fox sleeps');
    expect(diff.conflicts).toEqual([]);
    expect(diff.ours.some((segment) => segment.conflict)).toBe(false);
    expect(diff.theirs.some((segment) => segment.conflict)).toBe(false);
  });

  test('does not conflict when both sides make the same edit', () => {
    const diff = threeWayTextDiff('red fox', 'blue fox', 'blue fox');
    expect(diff.conflicts).toEqual([]);
  });

  test('marks delete-vs-replace of the same base word as a conflict', () => {
    const diff = threeWayTextDiff('keep red fox', 'keep fox', 'keep blue fox');
    expect(diff.conflicts).toHaveLength(1);
    expect(diff.conflicts[0]).toMatchObject({ baseText: 'red ', oursText: '', theirsText: 'blue' });
  });
});
