import { describe, expect, test } from 'bun:test';
import type { LiveCue } from './yjs';
import { threeWayCueListDiff } from './cue-list-diff';

function cue(overrides: Partial<LiveCue> = {}): LiveCue {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    orderIndex: 0,
    startMs: 1_000,
    endMs: 2_000,
    text: 'base',
    styleName: 'Default',
    speakerId: null,
    confidence: null,
    needsReview: false,
    ...overrides,
  };
}

describe('threeWayCueListDiff (SFM-37)', () => {
  test('classifies independent additions and removals against the base', () => {
    const base = cue();
    const added = cue({
      id: '22222222-2222-4222-8222-222222222222',
      startMs: 3_000,
      endMs: 4_000,
      text: 'new',
    });
    const diff = threeWayCueListDiff([base], [base, added], []);
    expect(diff.summary).toEqual({ added: 1, removed: 1, modified: 0, unchanged: 0, conflicts: 0 });
    expect(diff.rows.map((row) => [row.kind, row.oursChange, row.theirsChange])).toEqual([
      ['removed', 'unchanged', 'removed'],
      ['added', 'added', 'unchanged'],
    ]);
  });

  test('reports modified fields separately for ours and theirs', () => {
    const base = cue();
    const ours = cue({ text: 'our edit' });
    const theirs = cue({ endMs: 2_500 });
    const [row] = threeWayCueListDiff([base], [ours], [theirs]).rows;
    expect(row).toMatchObject({
      kind: 'modified',
      oursChange: 'modified',
      theirsChange: 'modified',
      oursChangedFields: ['text'],
      theirsChangedFields: ['endMs'],
      conflict: true,
    });
  });

  test('treats equal edits on both sides as non-conflicting', () => {
    const base = cue();
    const edit = cue({ text: 'same edit' });
    const [row] = threeWayCueListDiff([base], [edit], [edit]).rows;
    expect(row!.kind).toBe('modified');
    expect(row!.conflict).toBe(false);
  });

  test('rounds startMs to ASS centiseconds for stable identity', () => {
    const base = cue({ startMs: 1_001 });
    const ours = cue({ startMs: 1_004, text: 'retimed inside same centisecond' });
    const diff = threeWayCueListDiff([base], [ours], [base]);
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0]!.anchorMs).toBe(1_000);
    expect(diff.rows[0]!.oursChangedFields).toEqual(['startMs', 'text']);
  });

  test('uses cue ids only to disambiguate equal rounded start times', () => {
    const first = cue({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', text: 'first' });
    const second = cue({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      orderIndex: 1,
      text: 'second',
    });
    const diff = threeWayCueListDiff(
      [first, second],
      [{ ...second, text: 'second changed' }, first],
      [first, second],
    );
    expect(diff.rows).toHaveLength(2);
    expect(diff.rows.find((row) => row.base?.id === second.id)?.oursChangedFields).toEqual([
      'text',
    ]);
  });
});
