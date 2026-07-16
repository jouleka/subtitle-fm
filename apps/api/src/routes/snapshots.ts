import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@subtitle-fm/db';
import { threeWayCueListDiff } from '@subtitle-fm/shared';
import { liveCuesFromSnapshot } from '@subtitle-fm/shared/yjs';
import { db } from '../lib/db';
import { fetchCurrentDocumentState, restoreCollaborativeSnapshot } from '../lib/collab';
import { requireSession, type AuthVariables } from '../lib/session';

const createMilestoneSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase letters, digits, dots, dashes, underscores'),
});

const compareSnapshotsSchema = z
  .object({
    base: z.string().uuid(),
    ours: z.string().uuid(),
    theirs: z.string().uuid(),
  })
  .refine(({ base, ours, theirs }) => new Set([base, ours, theirs]).size === 3, {
    message: 'base, ours, and theirs must be different snapshots',
  });

async function episodeExists(episodeId: string): Promise<boolean> {
  const [episode] = await db
    .select({ id: schema.episodes.id })
    .from(schema.episodes)
    .where(eq(schema.episodes.id, episodeId))
    .limit(1);
  return Boolean(episode);
}

export const snapshots = new Hono<{ Variables: AuthVariables }>()
  .get('/', async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    if (!(await episodeExists(episodeId))) return c.json({ error: 'episode_not_found' }, 404);

    const rows = await db
      .select({
        id: schema.snapshots.id,
        label: schema.snapshots.label,
        createdBy: schema.snapshots.createdBy,
        createdAt: schema.snapshots.createdAt,
      })
      .from(schema.snapshots)
      .where(and(eq(schema.snapshots.episodeId, episodeId), ne(schema.snapshots.label, 'live')))
      .orderBy(desc(schema.snapshots.createdAt));
    return c.json({ snapshots: rows });
  })
  .get('/compare', requireSession, zValidator('query', compareSnapshotsSchema), async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    const selected = c.req.valid('query');
    const ids = [selected.base, selected.ours, selected.theirs];
    const rows = await db
      .select({
        id: schema.snapshots.id,
        label: schema.snapshots.label,
        createdAt: schema.snapshots.createdAt,
        yjsState: schema.snapshots.yjsState,
      })
      .from(schema.snapshots)
      .where(and(eq(schema.snapshots.episodeId, episodeId), inArray(schema.snapshots.id, ids)));
    if (rows.length !== 3) return c.json({ error: 'snapshot_not_found' }, 404);

    const byId = new Map(rows.map((snapshot) => [snapshot.id, snapshot]));
    const base = byId.get(selected.base)!;
    const ours = byId.get(selected.ours)!;
    const theirs = byId.get(selected.theirs)!;
    return c.json({
      snapshots: {
        base: { id: base.id, label: base.label, createdAt: base.createdAt },
        ours: { id: ours.id, label: ours.label, createdAt: ours.createdAt },
        theirs: { id: theirs.id, label: theirs.label, createdAt: theirs.createdAt },
      },
      diff: threeWayCueListDiff(
        liveCuesFromSnapshot(base.yjsState),
        liveCuesFromSnapshot(ours.yjsState),
        liveCuesFromSnapshot(theirs.yjsState),
      ),
    });
  })
  .post('/', requireSession, zValidator('json', createMilestoneSchema), async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    const { label } = c.req.valid('json');
    if (label === 'live' || /^published-v\d+$/.test(label)) {
      return c.json({ error: 'reserved_snapshot_label' }, 400);
    }
    if (!(await episodeExists(episodeId))) return c.json({ error: 'episode_not_found' }, 404);

    let yjsState: Uint8Array;
    try {
      yjsState = await fetchCurrentDocumentState(episodeId);
    } catch {
      return c.json({ error: 'collab_unavailable' }, 503);
    }
    const [created] = await db
      .insert(schema.snapshots)
      .values({ episodeId, label, yjsState, createdBy: c.get('user')!.id })
      .onConflictDoNothing({ target: [schema.snapshots.episodeId, schema.snapshots.label] })
      .returning({
        id: schema.snapshots.id,
        label: schema.snapshots.label,
        createdBy: schema.snapshots.createdBy,
        createdAt: schema.snapshots.createdAt,
      });
    if (!created) return c.json({ error: 'snapshot_label_exists' }, 409);
    return c.json(created, 201);
  })
  .post('/:snapshotId/restore', requireSession, async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    const snapshotId = c.req.param('snapshotId') as string;
    const [target] = await db
      .select({ id: schema.snapshots.id, label: schema.snapshots.label })
      .from(schema.snapshots)
      .where(
        and(
          eq(schema.snapshots.id, snapshotId),
          eq(schema.snapshots.episodeId, episodeId),
          ne(schema.snapshots.label, 'live'),
        ),
      )
      .limit(1);
    if (!target) return c.json({ error: 'snapshot_not_found' }, 404);

    let currentState: Uint8Array;
    try {
      currentState = await fetchCurrentDocumentState(episodeId);
    } catch {
      return c.json({ error: 'collab_unavailable' }, 503);
    }
    const backupLabel = `pre-restore-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const [backup] = await db
      .insert(schema.snapshots)
      .values({
        episodeId,
        label: backupLabel,
        yjsState: currentState,
        createdBy: c.get('user')!.id,
      })
      .returning({ id: schema.snapshots.id, label: schema.snapshots.label });

    try {
      await restoreCollaborativeSnapshot(episodeId, snapshotId);
    } catch {
      // Keep the pre-restore capture: a lost HTTP response is ambiguous and the
      // collab service may already have applied the restore. The backup is the
      // only guaranteed route back to the caller's previous visible state.
      return c.json({ error: 'collab_unavailable', backup }, 503);
    }
    return c.json({ restored: target, backup });
  });
