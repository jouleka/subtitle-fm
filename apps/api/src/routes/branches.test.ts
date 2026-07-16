import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import * as Y from 'yjs';
import { schema } from '@subtitle-fm/db';
import { hydrateCuesIntoDoc, liveCuesFromSnapshot, type CueSeed } from '@subtitle-fm/shared/yjs';
import { db } from '../lib/db';
import * as authModule from '../lib/auth';

const SHOW_ID = 'test-show-sfm39-branches';
const EPISODE_ID = '39393939-3939-4393-8393-393939393939';
const USER = {
  id: '39393939-0000-4000-8000-000000000001',
  handle: 'sfm39-user',
  email: 'sfm39@example.com',
};
const SESSION = {
  id: '39393939-0000-4000-8000-000000000002',
  userId: USER.id,
  token: 'sfm39-token',
  expiresAt: new Date(Date.now() + 86_400_000),
};
const FIRST_ID = '39393939-3939-4393-8393-393939390001';
const SECOND_ID = '39393939-3939-4393-8393-393939390002';

const getSessionMock = mock();
let liveState = encoded([cue(FIRST_ID, 'first'), cue(SECOND_ID, 'second', 1, 2_000)]);
let branchState = liveState;
const currentStateMock = mock(async () => liveState);
const branchStateMock = mock(async () => branchState);
const restoreMock = mock(async () => {});

mock.module('../lib/collab', () => ({
  fetchCurrentDocumentState: currentStateMock,
  fetchBranchDocumentState: branchStateMock,
  restoreCollaborativeSnapshot: restoreMock,
}));

const { app } = await import('../index');

function cue(id: string, text: string, orderIndex = 0, startMs = 0): CueSeed {
  return {
    id,
    orderIndex,
    startMs,
    endMs: startMs + 1_000,
    text,
    styleName: 'Default',
    speakerId: null,
    confidence: null,
    needsReview: false,
  };
}

function encoded(cues: CueSeed[]): Uint8Array {
  const document = new Y.Doc();
  hydrateCuesIntoDoc(document, cues);
  return Y.encodeStateAsUpdate(document);
}

function request(path: string, method = 'GET', body?: unknown) {
  return app.request(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function clearBranchesAndSnapshots() {
  await db.delete(schema.subtitleBranches).where(eq(schema.subtitleBranches.episodeId, EPISODE_ID));
  await db.delete(schema.snapshots).where(eq(schema.snapshots.episodeId, EPISODE_ID));
}

async function createBase(label = 'base') {
  const [base] = await db
    .insert(schema.snapshots)
    .values({ episodeId: EPISODE_ID, label, yjsState: encoded([cue(FIRST_ID, 'first'), cue(SECOND_ID, 'second', 1, 2_000)]) })
    .returning({ id: schema.snapshots.id });
  return base!;
}

async function createBranch(baseSnapshotId: string, name = 'alternate') {
  const [branch] = await db
    .insert(schema.subtitleBranches)
    .values({
      episodeId: EPISODE_ID,
      name,
      baseSnapshotId,
      yjsState: branchState,
      createdBy: USER.id,
    })
    .returning({ id: schema.subtitleBranches.id });
  return branch!;
}

beforeAll(async () => {
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW_ID));
  await db.delete(schema.users).where(eq(schema.users.id, USER.id));
  await db.insert(schema.users).values(USER);
  await db.insert(schema.shows).values({ id: SHOW_ID, title: 'SFM-39', slug: SHOW_ID });
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
  await clearBranchesAndSnapshots();
  liveState = encoded([cue(FIRST_ID, 'first'), cue(SECOND_ID, 'second', 1, 2_000)]);
  branchState = liveState;
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ user: USER, session: SESSION });
  currentStateMock.mockReset();
  currentStateMock.mockImplementation(async () => liveState);
  branchStateMock.mockReset();
  branchStateMock.mockImplementation(async () => branchState);
  restoreMock.mockReset();
  restoreMock.mockImplementation(async () => {});
});

describe('subtitle branches (SFM-39)', () => {
  test('requires authentication', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    expect((await request(`/episodes/${EPISODE_ID}/branches`)).status).toBe(401);
  });

  test('forks an immutable milestone and exposes its cues', async () => {
    const base = await createBase();
    const created = await request(`/episodes/${EPISODE_ID}/branches`, 'POST', {
      name: 'alternate-ed',
      baseSnapshotId: base.id,
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; baseSnapshotId: string };
    expect(body.baseSnapshotId).toBe(base.id);

    const detail = await request(`/episodes/${EPISODE_ID}/branches/${body.id}`);
    expect(detail.status).toBe(200);
    const branch = (await detail.json()) as { name: string; cues: CueSeed[] };
    expect(branch.name).toBe('alternate-ed');
    expect(branch.cues.map((item) => item.text)).toEqual(['first', 'second']);
  });

  test('rejects duplicate names and the mutable live snapshot as a base', async () => {
    const base = await createBase();
    expect(
      (
        await request(`/episodes/${EPISODE_ID}/branches`, 'POST', {
          name: 'same',
          baseSnapshotId: base.id,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(`/episodes/${EPISODE_ID}/branches`, 'POST', {
          name: 'same',
          baseSnapshotId: base.id,
        })
      ).status,
    ).toBe(409);

    const [live] = await db
      .insert(schema.snapshots)
      .values({ episodeId: EPISODE_ID, label: 'live', yjsState: liveState })
      .returning({ id: schema.snapshots.id });
    expect(
      (
        await request(`/episodes/${EPISODE_ID}/branches`, 'POST', {
          name: 'from-live',
          baseSnapshotId: live!.id,
        })
      ).status,
    ).toBe(404);
  });

  test('compares the exact active live and branch documents against their base', async () => {
    const base = await createBase();
    const branch = await createBranch(base.id);
    liveState = encoded([cue(FIRST_ID, 'live first'), cue(SECOND_ID, 'second', 1, 2_000)]);
    branchState = encoded([cue(FIRST_ID, 'first'), cue(SECOND_ID, 'branch second', 1, 2_000)]);

    const response = await request(`/episodes/${EPISODE_ID}/branches/${branch.id}/compare`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { diff: { summary: Record<string, number> } };
    expect(body.diff.summary).toMatchObject({ modified: 2, conflicts: 0 });
    expect(currentStateMock).toHaveBeenCalledWith(EPISODE_ID);
    expect(branchStateMock).toHaveBeenCalledWith(branch.id);
  });

  test('merges independent changes into a milestone and closes the branch', async () => {
    const base = await createBase();
    const branch = await createBranch(base.id);
    liveState = encoded([cue(FIRST_ID, 'live first'), cue(SECOND_ID, 'second', 1, 2_000)]);
    branchState = encoded([cue(FIRST_ID, 'first'), cue(SECOND_ID, 'branch second', 1, 2_000)]);

    const response = await request(`/episodes/${EPISODE_ID}/branches/${branch.id}/merge`, 'POST');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { mergeSnapshot: { id: string } };
    expect(restoreMock).toHaveBeenCalledWith(EPISODE_ID, body.mergeSnapshot.id);
    const [snapshot] = await db
      .select({ yjsState: schema.snapshots.yjsState })
      .from(schema.snapshots)
      .where(eq(schema.snapshots.id, body.mergeSnapshot.id));
    expect(liveCuesFromSnapshot(snapshot!.yjsState).map((item) => item.text)).toEqual([
      'live first',
      'branch second',
    ]);
    const [stored] = await db
      .select({ status: schema.subtitleBranches.status, mergedBy: schema.subtitleBranches.mergedBy })
      .from(schema.subtitleBranches)
      .where(eq(schema.subtitleBranches.id, branch.id));
    expect(stored).toEqual({ status: 'merged', mergedBy: USER.id });
  });

  test('returns conflicts without changing live or closing the branch', async () => {
    const base = await createBase();
    const branch = await createBranch(base.id);
    liveState = encoded([cue(FIRST_ID, 'live'), cue(SECOND_ID, 'second', 1, 2_000)]);
    branchState = encoded([cue(FIRST_ID, 'branch'), cue(SECOND_ID, 'second', 1, 2_000)]);

    const response = await request(`/episodes/${EPISODE_ID}/branches/${branch.id}/merge`, 'POST');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'merge_conflicts' });
    expect(restoreMock).not.toHaveBeenCalled();
    const [stored] = await db
      .select({ status: schema.subtitleBranches.status })
      .from(schema.subtitleBranches)
      .where(
        and(
          eq(schema.subtitleBranches.id, branch.id),
          eq(schema.subtitleBranches.episodeId, EPISODE_ID),
        ),
      );
    expect(stored!.status).toBe('open');
  });
});
