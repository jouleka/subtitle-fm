import { describe, expect, test } from 'bun:test';
import type { LiveCue } from './yjs';
import { mergeCueLists, threeWayCueListDiff } from './cue-list-diff';

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

describe('mergeCueLists (SFM-39)', () => {
  test('combines independent live and branch edits', () => {
    const first = cue({ text: 'first', id: 'first', startMs: 0, orderIndex: 0 });
    const second = cue({ text: 'second', id: 'second', startMs: 2_000, orderIndex: 1 });
    const result = mergeCueLists(
      [first, second],
      [{ ...first, text: 'live first' }, second],
      [first, { ...second, text: 'branch second' }],
    );
    expect(result.conflicts).toHaveLength(0);
    expect(result.cues.map((item) => item.text)).toEqual(['live first', 'branch second']);
  });

  test('refuses divergent edits to the same cue', () => {
    const base = cue({ text: 'base', id: 'same' });
    const result = mergeCueLists([base], [{ ...base, text: 'live' }], [{ ...base, text: 'branch' }]);
    expect(result.cues).toHaveLength(0);
    expect(result.conflicts).toHaveLength(1);
  });

  test('applies branch additions and removals while reindexing', () => {
    const removed = cue({ text: 'remove', id: 'removed', orderIndex: 0, startMs: 0 });
    const kept = cue({ text: 'keep', id: 'kept', orderIndex: 1, startMs: 2_000 });
    const added = cue({ text: 'added', id: 'added', orderIndex: 2, startMs: 4_000 });
    const result = mergeCueLists([removed, kept], [removed, kept], [kept, added]);
    expect(result.cues.map((item) => [item.text, item.orderIndex])).toEqual([
      ['keep', 0],
      ['added', 1],
    ]);
  });
});
