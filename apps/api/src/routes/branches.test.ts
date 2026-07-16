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
  await db.insert(schema.users).values({ ...USER, role: 'admin' });
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
  await db.delete(schema.showRoleAssignments).where(eq(schema.showRoleAssignments.showId, SHOW_ID));
  await db
    .update(schema.users)
    .set({ role: 'admin', reputation: 0 })
    .where(eq(schema.users.id, USER.id));
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
    const body = (await response.json()) as {
      mergeSnapshot: { id: string };
      reputationAward: number;
    };
    expect(body.reputationAward).toBe(1);
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
    const [author] = await db
      .select({ reputation: schema.users.reputation })
      .from(schema.users)
      .where(eq(schema.users.id, USER.id));
    expect(author!.reputation).toBe(1);
  });

  test('returns conflicts without changing live or closing the branch', async () => {
    const base = await createBase();
    const branch = await createBranch(base.id);
    liveState = encoded([cue(FIRST_ID, 'live'), cue(SECOND_ID, 'second', 1, 2_000)]);
    branchState = encoded([cue(FIRST_ID, 'branch'), cue(SECOND_ID, 'second', 1, 2_000)]);

    const response = await request(`/episodes/${EPISODE_ID}/branches/${branch.id}/merge`, 'POST');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: 'merge_conflicts',
      unresolvedKeys: ['0:0'],
      invalidKeys: [],
    });
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

  test('applies and records a manual reviewer decision in the merge result', async () => {
    const base = await createBase();
    const branch = await createBranch(base.id);
    liveState = encoded([cue(FIRST_ID, 'live'), cue(SECOND_ID, 'second', 1, 2_000)]);
    branchState = encoded([cue(FIRST_ID, 'branch'), cue(SECOND_ID, 'second', 1, 2_000)]);

    const response = await request(`/episodes/${EPISODE_ID}/branches/${branch.id}/merge`, 'POST', {
      resolutions: [{ key: '0:0', choice: 'manual', manualText: 'reviewed result' }],
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { mergeSnapshot: { id: string } };
    const [snapshot] = await db
      .select({ yjsState: schema.snapshots.yjsState })
      .from(schema.snapshots)
      .where(eq(schema.snapshots.id, body.mergeSnapshot.id));
    expect(liveCuesFromSnapshot(snapshot!.yjsState)[0]!.text).toBe('reviewed result');

    const [stored] = await db
      .select({ mergeDecisions: schema.subtitleBranches.mergeDecisions })
      .from(schema.subtitleBranches)
      .where(eq(schema.subtitleBranches.id, branch.id));
    expect(stored!.mergeDecisions).toEqual([
      {
        key: '0:0',
        choice: 'manual',
        manualText: 'reviewed result',
        baseText: 'first',
        oursText: 'live',
        theirsText: 'branch',
        resultText: 'reviewed result',
      },
    ]);
  });

  test('requires show role plus reputation before merging', async () => {
    const base = await createBase();
    const branch = await createBranch(base.id);
    await db
      .update(schema.users)
      .set({ role: 'editor', reputation: 9 })
      .where(eq(schema.users.id, USER.id));
    await db.insert(schema.showRoleAssignments).values({
      userId: USER.id,
      showId: SHOW_ID,
      role: 'tl',
    });

    const denied = await request(`/episodes/${EPISODE_ID}/branches/${branch.id}/merge`, 'POST');
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      error: 'merge_forbidden',
      access: { reputation: 9, showRole: 'tl', canMerge: false },
    });

    await db
      .update(schema.users)
      .set({ reputation: 10 })
      .where(eq(schema.users.id, USER.id));
    const allowed = await request(`/episodes/${EPISODE_ID}/branches/${branch.id}/merge`, 'POST');
    expect(allowed.status).toBe(200);
  });

  test('rejects a branch and decays its author reputation by changed cue count', async () => {
    const base = await createBase();
    const branch = await createBranch(base.id);
    branchState = encoded([cue(FIRST_ID, 'rejected edit'), cue(SECOND_ID, 'second', 1, 2_000)]);
    await db
      .update(schema.users)
      .set({ reputation: 5 })
      .where(eq(schema.users.id, USER.id));

    const response = await request(
      `/episodes/${EPISODE_ID}/branches/${branch.id}/reject`,
      'POST',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      branch: { status: 'rejected', rejectedBy: USER.id },
      reputationPenalty: 1,
    });
    const [author] = await db
      .select({ reputation: schema.users.reputation })
      .from(schema.users)
      .where(eq(schema.users.id, USER.id));
    expect(author!.reputation).toBe(4);
  });

  test('rejects duplicate or incomplete resolution payloads', async () => {
    const base = await createBase();
    const branch = await createBranch(base.id);
    const duplicate = await request(
      `/episodes/${EPISODE_ID}/branches/${branch.id}/merge`,
      'POST',
      {
        resolutions: [
          { key: '0:0', choice: 'ours' },
          { key: '0:0', choice: 'theirs' },
        ],
      },
    );
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({ error: 'invalid_merge_resolutions' });

    const manual = await request(`/episodes/${EPISODE_ID}/branches/${branch.id}/merge`, 'POST', {
      resolutions: [{ key: '0:0', choice: 'manual' }],
    });
    expect(manual.status).toBe(400);
  });
});
