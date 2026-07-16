import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hocuspocus } from '@hocuspocus/server';
import { and, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { schema } from '@subtitle-fm/db';
import {
  hydrateCuesIntoDoc,
  liveCuesFromDoc,
  liveCuesFromSnapshot,
  replaceCuesInDoc,
  type CueSeed,
} from '@subtitle-fm/shared/yjs';
import { db } from './db';
import { databaseExtension } from './persistence';
import { currentDocumentState, restoreDocumentState } from './internal-api';

const SHOW_ID = 'test-show-sfm36-collab';
const EPISODE_ID = '36363636-3636-4363-8363-363636363637';

function cue(text: string): CueSeed {
  return {
    id: '36363636-3636-4363-8363-363636360001',
    orderIndex: 0,
    startMs: 0,
    endMs: 1000,
    text,
    styleName: 'Default',
    speakerId: null,
    confidence: null,
    needsReview: false,
  };
}

function encoded(text: string): Uint8Array {
  const doc = new Y.Doc();
  hydrateCuesIntoDoc(doc, [cue(text)]);
  return Y.encodeStateAsUpdate(doc);
}

async function cleanup() {
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW_ID));
}

beforeAll(async () => {
  await cleanup();
  await db.insert(schema.shows).values({ id: SHOW_ID, title: 'SFM-36', slug: SHOW_ID });
  await db.insert(schema.episodes).values({
    id: EPISODE_ID,
    showId: SHOW_ID,
    number: 1,
    status: 'ready_for_edit',
  });
  await db.insert(schema.cues).values({
    id: cue('seed').id,
    episodeId: EPISODE_ID,
    orderIndex: 0,
    startMs: 0,
    endMs: 1000,
    text: 'seed',
    styleName: 'Default',
    needsReview: false,
  });
});

afterAll(cleanup);

describe('collab snapshot bridge (SFM-36)', () => {
  test('captures and restores the active document while it remains connected', async () => {
    const instance = new Hocuspocus({ extensions: [databaseExtension] });
    const connection = await instance.openDirectConnection(EPISODE_ID);
    await connection.transact((document) => replaceCuesInDoc(document, [cue('current edit')]));

    const current = await currentDocumentState(instance, EPISODE_ID);
    expect(liveCuesFromSnapshot(current!)[0]!.text).toBe('current edit');

    const [milestone] = await db
      .insert(schema.snapshots)
      .values({ episodeId: EPISODE_ID, label: 'first-pass', yjsState: encoded('milestone') })
      .returning({ id: schema.snapshots.id });
    expect(await restoreDocumentState(instance, EPISODE_ID, milestone!.id)).toEqual({
      label: 'first-pass',
    });
    expect(liveCuesFromDoc(connection.document!)[0]!.text).toBe('milestone');

    await connection.disconnect();
    const [live] = await db
      .select({ yjsState: schema.snapshots.yjsState })
      .from(schema.snapshots)
      .where(and(eq(schema.snapshots.episodeId, EPISODE_ID), eq(schema.snapshots.label, 'live')));
    expect(liveCuesFromSnapshot(live!.yjsState)[0]!.text).toBe('milestone');
  });

  test('does not expose the mutable live row as a restore target', async () => {
    const instance = new Hocuspocus({ extensions: [databaseExtension] });
    const [live] = await db
      .select({ id: schema.snapshots.id })
      .from(schema.snapshots)
      .where(and(eq(schema.snapshots.episodeId, EPISODE_ID), eq(schema.snapshots.label, 'live')));
    expect(await restoreDocumentState(instance, EPISODE_ID, live!.id)).toBeNull();
  });
});
