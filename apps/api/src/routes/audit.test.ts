import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';
import * as authModule from '../lib/auth';

const SHOW_ID = 'test-show-sfm33-audit';
const EPISODE_ID = '33333333-3333-4333-8333-333333333301';
const CUE_ID = '33333333-3333-4333-8333-333333333302';
const USER = {
  id: '33333333-3333-4333-8333-333333333303',
  handle: 'sfm33-editor',
  email: 'sfm33@example.com',
};
const SESSION = {
  id: '33333333-3333-4333-8333-333333333304',
  userId: USER.id,
  token: 'sfm33-token',
  expiresAt: new Date(Date.now() + 86_400_000),
};

const getSessionMock = mock();
const { app } = await import('../index');

async function cleanup() {
  await db.delete(schema.auditLog).where(eq(schema.auditLog.episodeId, EPISODE_ID));
  await db.delete(schema.episodes).where(eq(schema.episodes.id, EPISODE_ID));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW_ID));
  await db.delete(schema.users).where(eq(schema.users.id, USER.id));
}

beforeAll(async () => {
  await cleanup();
  (authModule.auth.api.getSession as unknown) = getSessionMock;
  await db.insert(schema.users).values(USER);
  await db.insert(schema.shows).values({ id: SHOW_ID, title: 'SFM-33', slug: SHOW_ID });
  await db.insert(schema.episodes).values({
    id: EPISODE_ID,
    showId: SHOW_ID,
    number: 1,
    status: 'ready_for_edit',
  });
  await db.insert(schema.auditLog).values(
    Array.from({ length: 6 }, (_, index) => ({
      episodeId: EPISODE_ID,
      cueId: CUE_ID,
      userId: USER.id,
      fieldChanged: index === 0 ? 'needsReview' : 'text',
      oldValue: `old-${index}`,
      newValue: `new-${index}`,
      ts: new Date(Date.UTC(2026, 6, 16, 10, index)),
    })),
  );
});

beforeEach(() => {
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ user: USER, session: SESSION });
});

afterAll(cleanup);

describe('audit history routes (SFM-33)', () => {
  test('requires authentication', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    expect((await app.request(`/episodes/${EPISODE_ID}/audit`)).status).toBe(401);
  });

  test('returns an attributed newest-first episode timeline with pagination', async () => {
    const response = await app.request(`/episodes/${EPISODE_ID}/audit?limit=2`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      events: Array<{ userHandle: string; newValue: string; ts: string }>;
      hasMore: boolean;
      nextBefore: string;
      nextBeforeId: string;
    };
    expect(body.events.map((event) => event.newValue)).toEqual(['new-5', 'new-4']);
    expect(body.events[0]!.userHandle).toBe(USER.handle);
    expect(body.hasMore).toBe(true);

    const next = await app.request(
      `/episodes/${EPISODE_ID}/audit?limit=2&before=${encodeURIComponent(body.nextBefore)}&beforeId=${body.nextBeforeId}`,
    );
    expect(((await next.json()) as { events: Array<{ newValue: string }> }).events[0]!.newValue).toBe(
      'new-3',
    );
  });

  test('returns the last five changes for one cue by default', async () => {
    const response = await app.request(`/episodes/${EPISODE_ID}/audit/cues/${CUE_ID}`);
    const body = (await response.json()) as { events: Array<{ newValue: string }> };
    expect(body.events).toHaveLength(5);
    expect(body.events[0]!.newValue).toBe('new-5');
    expect(body.events[4]!.newValue).toBe('new-1');
  });
});
