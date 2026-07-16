import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as Y from 'yjs';
import { and, eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { hydrateCuesIntoDoc, liveCuesFromSnapshot, type CueSeed } from '@subtitle-fm/shared/yjs';
import { db } from '../lib/db';
import * as authModule from '../lib/auth';

const SHOW_ID = 'test-show-sfm36-snapshots';
const EPISODE_ID = '36363636-3636-4363-8363-363636363636';
const USER = {
  id: '36363636-0000-4000-8000-000000000001',
  handle: 'sfm36-user',
  email: 'sfm36@example.com',
};
const SESSION = {
  id: '36363636-0000-4000-8000-000000000002',
  userId: USER.id,
  token: 'sfm36-token',
  expiresAt: new Date(Date.now() + 86_400_000),
};

const getSessionMock = mock();
const restoreMock = mock(async () => {});
let currentState = stateWithText('current live');
const currentStateMock = mock(async () => currentState);

mock.module('../lib/collab', () => ({
  fetchCurrentDocumentState: currentStateMock,
  restoreCollaborativeSnapshot: restoreMock,
}));

const { app } = await import('../index');

function stateWithText(text: string): Uint8Array {
  return stateWithCues([seed(text)]);
}

function seed(text: string, overrides: Partial<CueSeed> = {}): CueSeed {
  return {
    id: crypto.randomUUID(),
    orderIndex: 0,
    startMs: 0,
    endMs: 1000,
    text,
    styleName: 'Default',
    speakerId: null,
    confidence: null,
    needsReview: false,
    ...overrides,
  };
}

function stateWithCues(cues: CueSeed[]): Uint8Array {
  const doc = new Y.Doc();
  hydrateCuesIntoDoc(doc, cues);
  return Y.encodeStateAsUpdate(doc);
}

function post(path: string, body?: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function clearSnapshots() {
  await db.delete(schema.snapshots).where(eq(schema.snapshots.episodeId, EPISODE_ID));
}

beforeAll(async () => {
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW_ID));
  await db.delete(schema.users).where(eq(schema.users.id, USER.id));
  await db.insert(schema.users).values(USER);
  await db.insert(schema.shows).values({ id: SHOW_ID, title: 'SFM-36', slug: SHOW_ID });
  await db.insert(schema.episodes).values({
    id: EPISODE_ID,
    showId: SHOW_ID,
    number: 1,
    status: 'ready_for_edit',
  });
  (authModule.auth.api.getSession as unknown) = getSessionMock;
});

afterAll(async () => {
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW_ID));
  await db.delete(schema.users).where(eq(schema.users.id, USER.id));
});

beforeEach(async () => {
  await clearSnapshots();
  getSessionMock.mockReset();
  currentStateMock.mockReset();
  restoreMock.mockReset();
  currentState = stateWithText('current live');
  currentStateMock.mockImplementation(async () => currentState);
  restoreMock.mockImplementation(async () => {});
});

describe('episode snapshot milestones (SFM-36)', () => {
  test('GET lists named snapshots without exposing live bytes', async () => {
    await db.insert(schema.snapshots).values([
      { episodeId: EPISODE_ID, label: 'live', yjsState: currentState },
      { episodeId: EPISODE_ID, label: 'first-pass', yjsState: currentState, createdBy: USER.id },
    ]);
    getSessionMock.mockResolvedValueOnce(null);
    const response = await app.request(`/episodes/${EPISODE_ID}/snapshots`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { snapshots: Record<string, unknown>[] };
    expect(body.snapshots).toHaveLength(1);
    expect(body.snapshots[0]!.label).toBe('first-pass');
    expect(body.snapshots[0]!.yjsState).toBeUndefined();
  });

  test('GET compare returns a three-way cue-list diff without exposing snapshot bytes', async () => {
    const stableId = '36363636-3636-4363-8363-363636360001';
    const [base, ours, theirs] = await db
      .insert(schema.snapshots)
      .values([
        {
          episodeId: EPISODE_ID,
          label: 'base',
          yjsState: stateWithCues([seed('base', { id: stableId })]),
        },
        {
          episodeId: EPISODE_ID,
          label: 'ours',
          yjsState: stateWithCues([seed('our edit', { id: stableId })]),
        },
        {
          episodeId: EPISODE_ID,
          label: 'theirs',
          yjsState: stateWithCues([
            seed('base', { id: stableId }),
            seed('added', { orderIndex: 1, startMs: 2_000, endMs: 3_000 }),
          ]),
        },
      ])
      .returning({ id: schema.snapshots.id });
    getSessionMock.mockResolvedValueOnce({ user: USER, session: SESSION });

    const query = new URLSearchParams({
      base: base!.id,
      ours: ours!.id,
      theirs: theirs!.id,
    });
    const response = await app.request(`/episodes/${EPISODE_ID}/snapshots/compare?${query}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      snapshots: { base: Record<string, unknown> };
      diff: { summary: Record<string, number>; rows: Array<Record<string, unknown>> };
    };
    expect(body.diff.summary).toMatchObject({ added: 1, modified: 1, conflicts: 0 });
    expect(body.diff.rows).toHaveLength(2);
    expect(body.snapshots.base.yjsState).toBeUndefined();
  });

  test('GET compare is authenticated and rejects snapshots from another episode', async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const query = new URLSearchParams({ base: ids[0]!, ours: ids[1]!, theirs: ids[2]! });
    getSessionMock.mockResolvedValueOnce(null);
    expect((await app.request(`/episodes/${EPISODE_ID}/snapshots/compare?${query}`)).status).toBe(
      401,
    );

    getSessionMock.mockResolvedValueOnce({ user: USER, session: SESSION });
    expect((await app.request(`/episodes/${EPISODE_ID}/snapshots/compare?${query}`)).status).toBe(
      404,
    );
  });

  test('POST captures the active collaborative document as an immutable milestone', async () => {
    getSessionMock.mockResolvedValueOnce({ user: USER, session: SESSION });
    const response = await post(`/episodes/${EPISODE_ID}/snapshots`, { label: 'first-pass' });
    expect(response.status).toBe(201);
    expect(currentStateMock).toHaveBeenCalledWith(EPISODE_ID);
    const [stored] = await db
      .select()
      .from(schema.snapshots)
      .where(
        and(eq(schema.snapshots.episodeId, EPISODE_ID), eq(schema.snapshots.label, 'first-pass')),
      );
    expect(stored!.createdBy).toBe(USER.id);
    expect(liveCuesFromSnapshot(stored!.yjsState)[0]!.text).toBe('current live');
  });

  test('POST rejects duplicate and system-reserved labels', async () => {
    await db.insert(schema.snapshots).values({
      episodeId: EPISODE_ID,
      label: 'qc',
      yjsState: currentState,
    });
    getSessionMock.mockResolvedValueOnce({ user: USER, session: SESSION });
    expect((await post(`/episodes/${EPISODE_ID}/snapshots`, { label: 'qc' })).status).toBe(409);
    getSessionMock.mockResolvedValueOnce({ user: USER, session: SESSION });
    expect(
      (await post(`/episodes/${EPISODE_ID}/snapshots`, { label: 'published-v2' })).status,
    ).toBe(400);
  });

  test('snapshot mutation requires a session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    expect((await post(`/episodes/${EPISODE_ID}/snapshots`, { label: 'qc' })).status).toBe(401);
  });

  test('restore creates a reversible backup then updates the live collab document', async () => {
    const targetState = stateWithText('first pass milestone');
    const [target] = await db
      .insert(schema.snapshots)
      .values({ episodeId: EPISODE_ID, label: 'first-pass', yjsState: targetState })
      .returning({ id: schema.snapshots.id });
    currentState = stateWithText('work after first pass');
    getSessionMock.mockResolvedValueOnce({ user: USER, session: SESSION });

    const response = await post(`/episodes/${EPISODE_ID}/snapshots/${target!.id}/restore`);
    expect(response.status).toBe(200);
    expect(restoreMock).toHaveBeenCalledWith(EPISODE_ID, target!.id);
    const body = (await response.json()) as { backup: { id: string; label: string } };
    expect(body.backup.label.startsWith('pre-restore-')).toBe(true);
    const [backup] = await db
      .select({ yjsState: schema.snapshots.yjsState })
      .from(schema.snapshots)
      .where(eq(schema.snapshots.id, body.backup.id));
    expect(liveCuesFromSnapshot(backup!.yjsState)[0]!.text).toBe('work after first pass');
  });

  test('restore keeps the automatic backup when the collab result is ambiguous', async () => {
    const [target] = await db
      .insert(schema.snapshots)
      .values({ episodeId: EPISODE_ID, label: 'qc', yjsState: currentState })
      .returning({ id: schema.snapshots.id });
    restoreMock.mockRejectedValueOnce(new Error('collab offline'));
    getSessionMock.mockResolvedValueOnce({ user: USER, session: SESSION });
    const response = await post(`/episodes/${EPISODE_ID}/snapshots/${target!.id}/restore`);
    expect(response.status).toBe(503);
    const rows = await db
      .select({ label: schema.snapshots.label })
      .from(schema.snapshots)
      .where(eq(schema.snapshots.episodeId, EPISODE_ID));
    const labels = rows.map((row) => row.label);
    expect(labels).toContain('qc');
    expect(labels.some((label) => label.startsWith('pre-restore-'))).toBe(true);
  });
});
