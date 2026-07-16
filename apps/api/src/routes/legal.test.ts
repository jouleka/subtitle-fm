import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import type { AuthVariables } from '../lib/session';
import { db } from '../lib/db';

const cleanupAdd = mock(async () => ({}));
const publishAdd = mock(async () => ({}));
const { createLegalRoutes, addBusinessDays } = await import('./legal');
const legal = createLegalRoutes({
  cleanupMediaQueue: { add: cleanupAdd },
  publishQueue: { add: publishAdd },
});

const SHOW = 'sfm46-legal-show';
const EPISODE = '46999999-0000-4000-8000-000000000001';
const ADMIN = '46999999-0000-4000-8000-000000000002';
const EDITOR = '46999999-0000-4000-8000-000000000003';
const SNAPSHOT = '46999999-0000-4000-8000-000000000004';

const app = new Hono<{ Variables: AuthVariables }>();
app.use('*', async (c, next) => {
  const id = c.req.header('x-test-user');
  c.set(
    'user',
    id
      ? ({ id, name: 'Test', email: 'test@example.com', emailVerified: true } as NonNullable<
          AuthVariables['user']
        >)
      : null,
  );
  c.set('session', null);
  await next();
});
app.route('/legal', legal);

const noticePayload = {
  claimantName: 'Rights Holder',
  claimantEmail: 'rights@example.com',
  claimantAddress: '100 Copyright Avenue, Example City',
  claimantPhone: '+1 202 555 0100',
  copyrightedWork: 'The copyrighted audiovisual work and its authorized subtitles.',
  materialUrl: `https://api.subtitle.fm/episodes/${EPISODE}/subtitle.srt`,
  signature: 'Rights Holder',
  goodFaithConfirmed: true,
  accuracyConfirmed: true,
};

async function clearFixtures() {
  await db.delete(schema.takedownNotices).where(eq(schema.takedownNotices.episodeId, EPISODE));
  await db.delete(schema.snapshots).where(eq(schema.snapshots.episodeId, EPISODE));
  await db.delete(schema.episodes).where(eq(schema.episodes.id, EPISODE));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
  await db.delete(schema.users).where(eq(schema.users.id, ADMIN));
  await db.delete(schema.users).where(eq(schema.users.id, EDITOR));
}

beforeAll(async () => {
  await clearFixtures();
  await db.insert(schema.users).values([
    { id: ADMIN, handle: 'sfm46-admin', email: 'sfm46-admin@example.com', role: 'admin' },
    { id: EDITOR, handle: 'sfm46-editor', email: 'sfm46-editor@example.com', role: 'editor' },
  ]);
  await db.insert(schema.shows).values({ id: SHOW, title: 'SFM-46', slug: 'sfm-46-legal' });
  await db.insert(schema.episodes).values({
    id: EPISODE,
    showId: SHOW,
    number: 1,
    status: 'published',
  });
  await db.insert(schema.snapshots).values({
    id: SNAPSHOT,
    episodeId: EPISODE,
    label: 'published-v1',
    yjsState: new Uint8Array([1, 2, 3]),
    createdBy: ADMIN,
  });
});

afterAll(clearFixtures);

describe('DMCA takedown workflow (SFM-46)', () => {
  test('notice -> admin review -> removal -> counter-notice -> timed restore', async () => {
    const submitted = await app.request('/legal/takedowns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(noticePayload),
    });
    expect(submitted.status).toBe(202);
    const noticeId = ((await submitted.json()) as { notice: { id: string } }).notice.id;

    expect((await app.request('/legal/admin/takedowns')).status).toBe(401);
    expect(
      (await app.request('/legal/admin/takedowns', { headers: { 'x-test-user': EDITOR } })).status,
    ).toBe(403);
    const adminList = await app.request('/legal/admin/takedowns', {
      headers: { 'x-test-user': ADMIN },
    });
    expect(adminList.status).toBe(200);
    expect(
      ((await adminList.json()) as { notices: { claimantEmail: string }[] }).notices[0]!
        .claimantEmail,
    ).toBe(noticePayload.claimantEmail);

    const beginReview = await app.request(`/legal/admin/takedowns/${noticeId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': ADMIN },
      body: JSON.stringify({ action: 'begin_review' }),
    });
    expect(beginReview.status).toBe(200);

    const remove = await app.request(`/legal/admin/takedowns/${noticeId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': ADMIN },
      body: JSON.stringify({ action: 'remove', notes: 'Notice contains the required elements.' }),
    });
    expect(remove.status).toBe(200);
    const [removedEpisode] = await db
      .select({ status: schema.episodes.status })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, EPISODE));
    expect(removedEpisode!.status).toBe('removed');
    expect(cleanupAdd).toHaveBeenCalledTimes(1);

    const counter = await app.request(`/legal/takedowns/${noticeId}/counter-notice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        submitterName: 'Uploader Name',
        submitterEmail: 'uploader@example.com',
        submitterAddress: '200 Response Street, Example City',
        submitterPhone: '+1 202 555 0199',
        removedMaterialUrl: noticePayload.materialUrl,
        signature: 'Uploader Name',
        mistakeConfirmed: true,
        jurisdictionConfirmed: true,
        serviceConfirmed: true,
      }),
    });
    expect(counter.status).toBe(202);
    const counterBody = (await counter.json()) as {
      counterNotice: { restoreEligibleAt: string; restoreDeadlineAt: string };
    };
    expect(new Date(counterBody.counterNotice.restoreDeadlineAt).getTime()).toBeGreaterThan(
      new Date(counterBody.counterNotice.restoreEligibleAt).getTime(),
    );

    const earlyRestore = await app.request(`/legal/admin/takedowns/${noticeId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': ADMIN },
      body: JSON.stringify({ action: 'restore' }),
    });
    expect(earlyRestore.status).toBe(409);
    expect(((await earlyRestore.json()) as { error: string }).error).toBe('restore_waiting_period');

    await db
      .update(schema.counterNotices)
      .set({ restoreEligibleAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.counterNotices.takedownNoticeId, noticeId));
    const restore = await app.request(`/legal/admin/takedowns/${noticeId}/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': ADMIN },
      body: JSON.stringify({ action: 'restore', notes: 'No court action received.' }),
    });
    expect(restore.status).toBe(202);
    expect(publishAdd).toHaveBeenCalledTimes(1);
    const [restoringEpisode] = await db
      .select({ status: schema.episodes.status })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, EPISODE));
    expect(restoringEpisode!.status).toBe('publishing');
  });

  test('rejects incomplete declarations and URLs that do not locate an episode', async () => {
    const incomplete = await app.request('/legal/takedowns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...noticePayload, goodFaithConfirmed: false }),
    });
    expect(incomplete.status).toBe(400);
    const unrelated = await app.request('/legal/takedowns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...noticePayload, materialUrl: 'https://subtitle.fm/shows/example' }),
    });
    expect(unrelated.status).toBe(400);
  });

  test('computes the statutory waiting window in business days', () => {
    const friday = new Date('2026-07-17T12:00:00.000Z');
    expect(addBusinessDays(friday, 1).toISOString()).toBe('2026-07-20T12:00:00.000Z');
    expect(addBusinessDays(friday, 10).toISOString()).toBe('2026-07-31T12:00:00.000Z');
  });
});
