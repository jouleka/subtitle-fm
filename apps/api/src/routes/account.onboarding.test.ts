import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';
import type { AuthVariables } from '../lib/session';
import { account } from './account';

const USER = '35999999-0000-4000-8000-000000000001';
const SHOW = 'sfm35-onboarding';
const FIRST = '35999999-0000-4000-8000-000000000011';
const SECOND = '35999999-0000-4000-8000-000000000012';

const app = new Hono<{ Variables: AuthVariables }>();
app.use('*', async (c, next) => {
  c.set('user', {
    id: USER,
    name: 'sfm35-contributor',
    email: 'sfm35@example.com',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    reputation: 0,
    role: 'editor',
    discordId: 'discord-sfm35',
  });
  c.set('session', null);
  await next();
});
app.route('/account', account);

beforeAll(async () => {
  await db.delete(schema.episodes).where(eq(schema.episodes.showId, SHOW));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  await db.insert(schema.users).values({
    id: USER,
    handle: 'sfm35-contributor',
    email: 'sfm35@example.com',
    discordId: 'discord-sfm35',
  });
  await db.insert(schema.shows).values({ id: SHOW, slug: SHOW, title: 'SFM-35 onboarding' });
  await db.insert(schema.episodes).values([
    {
      id: SECOND,
      showId: SHOW,
      number: 2,
      status: 'in_review',
      createdAt: new Date('2000-01-02T00:00:00.000Z'),
    },
    {
      id: FIRST,
      showId: SHOW,
      number: 1,
      status: 'ready_for_edit',
      createdAt: new Date('2000-01-01T00:00:00.000Z'),
    },
  ]);
});

afterAll(async () => {
  await db.delete(schema.episodes).where(eq(schema.episodes.showId, SHOW));
  await db.delete(schema.shows).where(eq(schema.shows.id, SHOW));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
});

describe('GET /account/first-contribution (SFM-35)', () => {
  test('selects the oldest episode open for community work', async () => {
    const response = await app.request('/account/first-contribution');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ episodeId: FIRST });
  });
});
