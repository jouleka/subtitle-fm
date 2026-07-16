import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  applyCueTextEdit,
  hydrateCuesIntoDoc,
  toggleCueNeedsReview,
  type CueSeed,
} from '@subtitle-fm/shared/yjs';
import {
  CueAuditTracker,
  createAuditExtension,
  diffCueAuditChanges,
  type AttributedCueAuditChange,
} from './audit';

const CUE_ID = '33333333-3333-4333-8333-333333333333';
const seed: CueSeed = {
  id: CUE_ID,
  orderIndex: 0,
  startMs: 0,
  endMs: 1000,
  text: 'old',
  styleName: 'Default',
  speakerId: null,
  confidence: null,
  needsReview: false,
};

function document() {
  const doc = new Y.Doc();
  hydrateCuesIntoDoc(doc, [seed]);
  return doc;
}

describe('cue audit capture (SFM-33)', () => {
  test('represents insertion and deletion as whole-cue events', () => {
    const before = new Map([[CUE_ID, { ...seed }]]);
    const inserted = { ...seed, id: crypto.randomUUID() };
    const after = new Map([[inserted.id, inserted]]);
    expect(diffCueAuditChanges(before, after)).toEqual([
      { cueId: CUE_ID, fieldChanged: 'cue', oldValue: seed, newValue: null },
      { cueId: inserted.id, fieldChanged: 'cue', oldValue: null, newValue: inserted },
    ]);
  });

  test('debounces successive text keystrokes into one attributed old-to-new event', async () => {
    const writes: AttributedCueAuditChange[][] = [];
    const tracker = new CueAuditTracker(
      async (changes) => void writes.push(changes),
      async () => 'episode-1',
      10,
    );
    const doc = document();
    tracker.seed('episode-1', doc);

    applyCueTextEdit(doc, CUE_ID, 'olde');
    await tracker.record('episode-1', doc, 'user-1');
    applyCueTextEdit(doc, CUE_ID, 'oldest');
    await tracker.record('episode-1', doc, 'user-1');
    expect(writes).toHaveLength(0);
    await Bun.sleep(25);

    expect(writes).toEqual([
      [
        {
          episodeId: 'episode-1',
          cueId: CUE_ID,
          userId: 'user-1',
          fieldChanged: 'text',
          oldValue: 'old',
          newValue: 'oldest',
        },
      ],
    ]);
    await tracker.flushAll();
  });

  test('writes non-text mutations immediately and flushes pending text on unload', async () => {
    const writes: AttributedCueAuditChange[][] = [];
    const tracker = new CueAuditTracker(
      async (changes) => void writes.push(changes),
      async (name) => (name === 'branch:one' ? 'episode-1' : null),
      10_000,
    );
    const doc = document();
    tracker.seed('branch:one', doc);

    toggleCueNeedsReview(doc, CUE_ID, true);
    await tracker.record('branch:one', doc, 'user-2');
    expect(writes[0]).toEqual([
      {
        episodeId: 'episode-1',
        cueId: CUE_ID,
        userId: 'user-2',
        fieldChanged: 'needsReview',
        oldValue: false,
        newValue: true,
      },
    ]);

    applyCueTextEdit(doc, CUE_ID, 'pending');
    await tracker.record('branch:one', doc, 'user-2');
    await tracker.release('branch:one');
    expect(writes[1]?.[0]).toMatchObject({ fieldChanged: 'text', newValue: 'pending' });
  });

  test('Hocuspocus hooks attribute changes to the authenticated connection context', async () => {
    const writes: AttributedCueAuditChange[][] = [];
    const tracker = new CueAuditTracker(
      async (changes) => void writes.push(changes),
      async () => 'episode-1',
      1,
    );
    const extension = createAuditExtension(tracker);
    const doc = document();
    await extension.afterLoadDocument!({ documentName: 'episode-1', document: doc } as never);
    toggleCueNeedsReview(doc, CUE_ID, true);
    await extension.onChange!({
      documentName: 'episode-1',
      document: doc,
      context: { user: { id: 'authenticated-user' } },
    } as never);
    expect(writes[0]?.[0]).toMatchObject({
      userId: 'authenticated-user',
      fieldChanged: 'needsReview',
    });
    await extension.onDestroy!({} as never);
  });
});
