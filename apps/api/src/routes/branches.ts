import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as Y from 'yjs';
import { schema } from '@subtitle-fm/db';
import { resolveCueListMerge, threeWayCueListDiff } from '@subtitle-fm/shared';
import { hydrateCuesIntoDoc, liveCuesFromSnapshot } from '@subtitle-fm/shared/yjs';
import { db } from '../lib/db';
import {
  fetchBranchDocumentState,
  fetchCurrentDocumentState,
  restoreCollaborativeSnapshot,
} from '../lib/collab';
import { requireSession, type AuthVariables } from '../lib/session';
import { getShowAccess } from '../lib/show-access';

const MAX_REPUTATION_CHANGE_PER_BRANCH = 20;

const createBranchSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase letters, digits, dots, dashes, underscores'),
  baseSnapshotId: z.string().uuid(),
});

const conflictResolutionSchema = z
  .object({
    key: z.string().min(1).max(128),
    choice: z.enum(['ours', 'theirs', 'manual']),
    manualText: z.string().max(20_000).optional(),
  })
  .superRefine((resolution, context) => {
    if (resolution.choice === 'manual' && resolution.manualText === undefined) {
      context.addIssue({ code: 'custom', path: ['manualText'], message: 'manualText is required' });
    }
  });

const mergeBranchSchema = z
  .object({ resolutions: z.array(conflictResolutionSchema).max(10_000).default([]) })
  .superRefine(({ resolutions }, context) => {
    const seen = new Set<string>();
    for (const [index, resolution] of resolutions.entries()) {
      if (seen.has(resolution.key)) {
        context.addIssue({
          code: 'custom',
          path: ['resolutions', index, 'key'],
          message: 'duplicate conflict key',
        });
      }
      seen.add(resolution.key);
    }
  });

const branchFields = {
  id: schema.subtitleBranches.id,
  episodeId: schema.subtitleBranches.episodeId,
  name: schema.subtitleBranches.name,
  baseSnapshotId: schema.subtitleBranches.baseSnapshotId,
  status: schema.subtitleBranches.status,
  createdBy: schema.subtitleBranches.createdBy,
  mergedBy: schema.subtitleBranches.mergedBy,
  rejectedBy: schema.subtitleBranches.rejectedBy,
  mergeDecisions: schema.subtitleBranches.mergeDecisions,
  createdAt: schema.subtitleBranches.createdAt,
  updatedAt: schema.subtitleBranches.updatedAt,
  mergedAt: schema.subtitleBranches.mergedAt,
  rejectedAt: schema.subtitleBranches.rejectedAt,
};

async function branchWithBase(episodeId: string, branchId: string) {
  const [row] = await db
    .select({
      ...branchFields,
      yjsState: schema.subtitleBranches.yjsState,
      baseLabel: schema.snapshots.label,
      baseCreatedAt: schema.snapshots.createdAt,
      baseYjsState: schema.snapshots.yjsState,
      showId: schema.episodes.showId,
    })
    .from(schema.subtitleBranches)
    .innerJoin(schema.snapshots, eq(schema.subtitleBranches.baseSnapshotId, schema.snapshots.id))
    .innerJoin(schema.episodes, eq(schema.subtitleBranches.episodeId, schema.episodes.id))
    .where(
      and(
        eq(schema.subtitleBranches.id, branchId),
        eq(schema.subtitleBranches.episodeId, episodeId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export const branches = new Hono<{ Variables: AuthVariables }>()
  .use('*', requireSession)
  .get('/', async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    const rows = await db
      .select(branchFields)
      .from(schema.subtitleBranches)
      .where(eq(schema.subtitleBranches.episodeId, episodeId))
      .orderBy(desc(schema.subtitleBranches.updatedAt));
    return c.json({ branches: rows });
  })
  .post('/', zValidator('json', createBranchSchema), async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    const { name, baseSnapshotId } = c.req.valid('json');
    const [base] = await db
      .select({ id: schema.snapshots.id, yjsState: schema.snapshots.yjsState })
      .from(schema.snapshots)
      .where(
        and(
          eq(schema.snapshots.id, baseSnapshotId),
          eq(schema.snapshots.episodeId, episodeId),
          ne(schema.snapshots.label, 'live'),
        ),
      )
      .limit(1);
    if (!base) return c.json({ error: 'snapshot_not_found' }, 404);

    const [created] = await db
      .insert(schema.subtitleBranches)
      .values({
        episodeId,
        name,
        baseSnapshotId,
        yjsState: base.yjsState,
        createdBy: c.get('user')!.id,
      })
      .onConflictDoNothing({
        target: [schema.subtitleBranches.episodeId, schema.subtitleBranches.name],
      })
      .returning(branchFields);
    if (!created) return c.json({ error: 'branch_name_exists' }, 409);
    return c.json(created, 201);
  })
  .get('/:branchId/compare', async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    const branchId = c.req.param('branchId');
    const branch = await branchWithBase(episodeId, branchId);
    if (!branch) return c.json({ error: 'branch_not_found' }, 404);

    let liveState: Uint8Array;
    let branchState: Uint8Array;
    try {
      [liveState, branchState] = await Promise.all([
        fetchCurrentDocumentState(episodeId),
        branch.status === 'open'
          ? fetchBranchDocumentState(branch.id)
          : Promise.resolve(branch.yjsState),
      ]);
    } catch {
      return c.json({ error: 'collab_unavailable' }, 503);
    }

    const {
      yjsState: _yjsState,
      baseYjsState: _baseYjsState,
      baseLabel: _baseLabel,
      baseCreatedAt: _baseCreatedAt,
      showId: _showId,
      ...metadata
    } = branch;

    return c.json({
      branch: metadata,
      snapshots: {
        base: { id: branch.baseSnapshotId, label: branch.baseLabel, createdAt: branch.baseCreatedAt },
        ours: { id: 'live', label: 'live', createdAt: new Date() },
        theirs: { id: branch.id, label: `branch:${branch.name}`, createdAt: branch.updatedAt },
      },
      diff: threeWayCueListDiff(
        liveCuesFromSnapshot(branch.baseYjsState),
        liveCuesFromSnapshot(liveState),
        liveCuesFromSnapshot(branchState),
      ),
    });
  })
  .post('/:branchId/merge', async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    const branchId = c.req.param('branchId');
    const branch = await branchWithBase(episodeId, branchId);
    if (!branch || branch.status !== 'open') return c.json({ error: 'branch_not_found' }, 404);
    const access = await getShowAccess(c.get('user')!.id, branch.showId);
    if (!access?.canMerge) return c.json({ error: 'merge_forbidden', access }, 403);
    const parsedInput = mergeBranchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsedInput.success) {
      return c.json({ error: 'invalid_merge_resolutions', issues: parsedInput.error.issues }, 400);
    }

    let liveState: Uint8Array;
    let branchState: Uint8Array;
    try {
      [liveState, branchState] = await Promise.all([
        fetchCurrentDocumentState(episodeId),
        fetchBranchDocumentState(branch.id),
      ]);
    } catch {
      return c.json({ error: 'collab_unavailable' }, 503);
    }

    const baseCues = liveCuesFromSnapshot(branch.baseYjsState);
    const liveCues = liveCuesFromSnapshot(liveState);
    const branchCues = liveCuesFromSnapshot(branchState);
    const diff = threeWayCueListDiff(baseCues, liveCues, branchCues);
    const merged = resolveCueListMerge(baseCues, liveCues, branchCues, parsedInput.data.resolutions);
    if (merged.unresolvedKeys.length > 0 || merged.invalidKeys.length > 0) {
      return c.json(
        {
          error: 'merge_conflicts',
          conflicts: merged.conflicts,
          unresolvedKeys: merged.unresolvedKeys,
          invalidKeys: merged.invalidKeys,
        },
        409,
      );
    }

    const document = new Y.Doc();
    hydrateCuesIntoDoc(document, merged.cues);
    const mergedState = Y.encodeStateAsUpdate(document);
    const label = `merge-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const [snapshot] = await db
      .insert(schema.snapshots)
      .values({
        episodeId,
        label,
        yjsState: mergedState,
        createdBy: c.get('user')!.id,
      })
      .returning({ id: schema.snapshots.id, label: schema.snapshots.label });

    try {
      await restoreCollaborativeSnapshot(episodeId, snapshot!.id);
    } catch {
      return c.json({ error: 'collab_unavailable', mergeSnapshot: snapshot }, 503);
    }

    const [updated] = await db
      .update(schema.subtitleBranches)
      .set({
        yjsState: branchState,
        status: 'merged',
        mergedBy: c.get('user')!.id,
        mergeDecisions: merged.decisions,
        mergedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.subtitleBranches.id, branch.id),
          eq(schema.subtitleBranches.status, 'open'),
        ),
      )
      .returning(branchFields);
    if (!updated) return c.json({ error: 'branch_already_merged', mergeSnapshot: snapshot }, 409);
    const resolutions = new Map(
      parsedInput.data.resolutions.map((resolution) => [resolution.key, resolution.choice]),
    );
    const reputationAward = Math.min(
      MAX_REPUTATION_CHANGE_PER_BRANCH,
      diff.rows.filter(
        (row) =>
          row.theirsChange !== 'unchanged' &&
          (!row.conflict || resolutions.get(row.key) === 'theirs'),
      ).length,
    );
    if (branch.createdBy && reputationAward > 0) {
      await db
        .update(schema.users)
        .set({ reputation: sql`${schema.users.reputation} + ${reputationAward}` })
        .where(eq(schema.users.id, branch.createdBy));
    }
    return c.json({ branch: updated, mergeSnapshot: snapshot, reputationAward });
  })
  .post('/:branchId/reject', async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    const branch = await branchWithBase(episodeId, c.req.param('branchId'));
    if (!branch || branch.status !== 'open') return c.json({ error: 'branch_not_found' }, 404);
    const access = await getShowAccess(c.get('user')!.id, branch.showId);
    if (!access?.canMerge) return c.json({ error: 'reject_forbidden', access }, 403);

    let branchState: Uint8Array;
    try {
      branchState = await fetchBranchDocumentState(branch.id);
    } catch {
      return c.json({ error: 'collab_unavailable' }, 503);
    }
    const baseCues = liveCuesFromSnapshot(branch.baseYjsState);
    const rejectedChanges = threeWayCueListDiff(
      baseCues,
      baseCues,
      liveCuesFromSnapshot(branchState),
    ).rows.filter((row) => row.theirsChange !== 'unchanged').length;
    const reputationPenalty = Math.min(MAX_REPUTATION_CHANGE_PER_BRANCH, rejectedChanges);

    const [updated] = await db
      .update(schema.subtitleBranches)
      .set({
        yjsState: branchState,
        status: 'rejected',
        rejectedBy: c.get('user')!.id,
        rejectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.subtitleBranches.id, branch.id),
          eq(schema.subtitleBranches.status, 'open'),
        ),
      )
      .returning(branchFields);
    if (!updated) return c.json({ error: 'branch_already_closed' }, 409);
    if (branch.createdBy && reputationPenalty > 0) {
      await db
        .update(schema.users)
        .set({
          reputation: sql`greatest(0, ${schema.users.reputation} - ${reputationPenalty})`,
        })
        .where(eq(schema.users.id, branch.createdBy));
    }
    return c.json({ branch: updated, reputationPenalty });
  })
  .get('/:branchId', async (c) => {
    const episodeId = c.req.param('episodeId') as string;
    const branch = await branchWithBase(episodeId, c.req.param('branchId'));
    if (!branch) return c.json({ error: 'branch_not_found' }, 404);
    const {
      yjsState,
      baseYjsState: _baseYjsState,
      baseLabel,
      baseCreatedAt,
      showId: _showId,
      ...metadata
    } = branch;
    return c.json({
      ...metadata,
      base: { id: branch.baseSnapshotId, label: baseLabel, createdAt: baseCreatedAt },
      cues: liveCuesFromSnapshot(yjsState),
    });
  });
