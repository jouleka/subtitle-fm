import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { db } from '../lib/db';
import { requireSession, type AuthVariables } from '../lib/session';
import { getShowAccess } from '../lib/show-access';

const createShowSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, and hyphens only'),
  description: z.string().optional(),
  malId: z.string().optional(),
  anilistId: z.string().optional(),
  kitsuId: z.string().optional(),
  coverUrl: z.string().url().optional(),
});

const showRoleSchema = z.object({ role: z.enum(['tl', 'tlc', 'ed', 'ts', 'qc']) });

async function existingShow(id: string) {
  const [show] = await db
    .select({ id: schema.shows.id })
    .from(schema.shows)
    .where(eq(schema.shows.id, id))
    .limit(1);
  return show ?? null;
}

export const shows = new Hono<{ Variables: AuthVariables }>()
  .get('/', async (c) => {
    const rows = await db.select().from(schema.shows).limit(100);
    return c.json({ shows: rows });
  })
  .get('/:id/access', requireSession, async (c) => {
    const showId = c.req.param('id') as string;
    if (!(await existingShow(showId))) return c.json({ error: 'not_found' }, 404);
    const access = await getShowAccess(c.get('user')!.id, showId);
    if (!access) return c.json({ error: 'user_not_found' }, 404);
    return c.json(access);
  })
  .get('/:id/roles', requireSession, async (c) => {
    const showId = c.req.param('id') as string;
    const access = await getShowAccess(c.get('user')!.id, showId);
    if (access?.globalRole !== 'admin') return c.json({ error: 'role_management_forbidden' }, 403);
    const assignments = await db
      .select({
        userId: schema.showRoleAssignments.userId,
        handle: schema.users.handle,
        role: schema.showRoleAssignments.role,
        assignedBy: schema.showRoleAssignments.assignedBy,
        createdAt: schema.showRoleAssignments.createdAt,
        updatedAt: schema.showRoleAssignments.updatedAt,
      })
      .from(schema.showRoleAssignments)
      .innerJoin(schema.users, eq(schema.showRoleAssignments.userId, schema.users.id))
      .where(eq(schema.showRoleAssignments.showId, showId));
    return c.json({ assignments });
  })
  .patch(
    '/:id/roles/:userId',
    requireSession,
    zValidator('json', showRoleSchema),
    async (c) => {
      const showId = c.req.param('id') as string;
      const userId = c.req.param('userId') as string;
      const access = await getShowAccess(c.get('user')!.id, showId);
      if (access?.globalRole !== 'admin') {
        return c.json({ error: 'role_management_forbidden' }, 403);
      }
      const [target] = await db
        .select({ userId: schema.users.id, showId: schema.shows.id })
        .from(schema.users)
        .innerJoin(schema.shows, eq(schema.shows.id, showId))
        .where(and(eq(schema.users.id, userId), eq(schema.shows.id, showId)))
        .limit(1);
      if (!target) return c.json({ error: 'user_or_show_not_found' }, 404);

      const [assignment] = await db
        .insert(schema.showRoleAssignments)
        .values({
          userId,
          showId,
          role: c.req.valid('json').role,
          assignedBy: c.get('user')!.id,
        })
        .onConflictDoUpdate({
          target: [schema.showRoleAssignments.userId, schema.showRoleAssignments.showId],
          set: {
            role: c.req.valid('json').role,
            assignedBy: c.get('user')!.id,
            updatedAt: new Date(),
          },
        })
        .returning();
      return c.json(assignment);
    },
  )
  .delete('/:id/roles/:userId', requireSession, async (c) => {
    const showId = c.req.param('id') as string;
    const userId = c.req.param('userId') as string;
    const access = await getShowAccess(c.get('user')!.id, showId);
    if (access?.globalRole !== 'admin') return c.json({ error: 'role_management_forbidden' }, 403);
    const [removed] = await db
      .delete(schema.showRoleAssignments)
      .where(
        and(
          eq(schema.showRoleAssignments.showId, showId),
          eq(schema.showRoleAssignments.userId, userId),
        ),
      )
      .returning({ userId: schema.showRoleAssignments.userId });
    if (!removed) return c.json({ error: 'role_assignment_not_found' }, 404);
    return c.body(null, 204);
  })
  .get('/:id', async (c) => {
    const id = c.req.param('id');
    const [row] = await db.select().from(schema.shows).where(eq(schema.shows.id, id)).limit(1);
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(row);
  })
  .post('/', requireSession, zValidator('json', createShowSchema), async (c) => {
    const input = c.req.valid('json');
    const [row] = await db
      .insert(schema.shows)
      .values({
        id: input.id,
        title: input.title,
        slug: input.slug,
        description: input.description ?? null,
        malId: input.malId ?? null,
        anilistId: input.anilistId ?? null,
        kitsuId: input.kitsuId ?? null,
        coverUrl: input.coverUrl ?? null,
      })
      .returning();
    return c.json(row, 201);
  });
