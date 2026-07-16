import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';
import * as authModule from '../lib/auth';

const SHOW_ID = 'test-show-sfm32-roles';
const ADMIN = {
  id: '32323232-0000-4000-8000-000000000001',
  handle: 'sfm32-admin',
  email: 'sfm32-admin@example.com',
};
const CONTRIBUTOR = {
  id: '32323232-0000-4000-8000-000000000002',
  handle: 'sfm32-contributor',
  email: 'sfm32-contributor@example.com',
};
const sessionFor = (userId: string) => ({
  id: crypto.randomUUID(),
  userId,
  token: `token-${userId}`,
  expiresAt: new Date(Date.now() + 86_400_000),
});

const getSessionMock = mock();
const { app } = await import('../index');

function authenticate(user: typeof ADMIN | typeof CONTRIBUTOR) {
  getSessionMock.mockResolvedValueOnce({ user, session: sessionFor(user.id) });
}

async function cleanup() {
  await db.delete(schema.showRoleAssignments).where(eq(schema.showRoleAssignments.showId, SHOW_ID));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW_ID));
  await db.delete(schema.users).where(eq(schema.users.id, CONTRIBUTOR.id));
  await db.delete(schema.users).where(eq(schema.users.id, ADMIN.id));
}

beforeAll(async () => {
  await cleanup();
  (authModule.auth.api.getSession as unknown) = getSessionMock;
  await db.insert(schema.users).values([
    { ...ADMIN, role: 'admin' },
    { ...CONTRIBUTOR, role: 'editor', reputation: 10 },
  ]);
  await db.insert(schema.shows).values({ id: SHOW_ID, title: 'SFM-32', slug: SHOW_ID });
});

beforeEach(async () => {
  getSessionMock.mockReset();
  await db.delete(schema.showRoleAssignments).where(eq(schema.showRoleAssignments.showId, SHOW_ID));
});

afterAll(cleanup);

describe('show reputation and roles (SFM-32)', () => {
  test('requires a session to inspect access', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const response = await app.request(`/shows/${SHOW_ID}/access`);
    expect(response.status).toBe(401);
  });

  test('admin assigns a per-show role which immediately unlocks thresholded merge access', async () => {
    authenticate(ADMIN);
    const assignment = await app.request(`/shows/${SHOW_ID}/roles/${CONTRIBUTOR.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'tlc' }),
    });
    expect(assignment.status).toBe(200);
    expect(await assignment.json()).toMatchObject({
      userId: CONTRIBUTOR.id,
      showId: SHOW_ID,
      role: 'tlc',
      assignedBy: ADMIN.id,
    });

    authenticate(CONTRIBUTOR);
    const access = await app.request(`/shows/${SHOW_ID}/access`);
    expect(await access.json()).toEqual({
      reputation: 10,
      globalRole: 'editor',
      showRole: 'tlc',
      thresholds: { merge: 10, publish: 30 },
      canSuggest: true,
      canMerge: true,
      canPublish: false,
    });
  });

  test('non-admin contributors cannot assign roles', async () => {
    authenticate(CONTRIBUTOR);
    const response = await app.request(`/shows/${SHOW_ID}/roles/${CONTRIBUTOR.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'qc' }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'role_management_forbidden' });
  });
});
