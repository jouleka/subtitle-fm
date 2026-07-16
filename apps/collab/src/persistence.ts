import { Database } from "@hocuspocus/extension-database";
import { db } from "./db";
import { schema } from "@subtitle-fm/db";
import { and, asc, eq } from "drizzle-orm";
import * as Y from "yjs";
import { hydrateCuesIntoDoc, type CueSeed } from "@subtitle-fm/shared/yjs";

const LIVE_LABEL = "live";
export const BRANCH_DOCUMENT_PREFIX = "branch:";

export function branchIdFromDocumentName(documentName: string): string | null {
  return documentName.startsWith(BRANCH_DOCUMENT_PREFIX)
    ? documentName.slice(BRANCH_DOCUMENT_PREFIX.length)
    : null;
}

/**
 * Stable clientID for the seed hydration. Yjs's Y.Doc defaults to a random
 * clientID per instance — without pinning, every call to fetchDocumentState
 * produces ops attributed to a NEW author, so Hocuspocus's applyUpdate
 * treats repeated hydrations as additional inserts (3 cues become 6, 9, ...).
 * A fixed clientID makes the encoded bytes deterministic — Yjs sees the same
 * clientID/clock pair already in the doc state and skips on subsequent applies.
 * 1 is reserved for "the server seed"; real client connections get random IDs
 * that won't collide in practice (32-bit space).
 */
const SEED_CLIENT_ID = 1;

/**
 * Resolve the Y.Doc bytes for an episode:
 *   1. If a 'live' snapshot exists, return it directly.
 *   2. Otherwise, hydrate a fresh Y.Doc from the cues table and return its encoded state.
 *
 * documentName is the episode UUID.
 */
export async function fetchDocumentState(
  documentName: string,
): Promise<Uint8Array | null> {
  const branchId = branchIdFromDocumentName(documentName);
  if (branchId) {
    const [branch] = await db
      .select({ yjsState: schema.subtitleBranches.yjsState })
      .from(schema.subtitleBranches)
      .where(
        and(
          eq(schema.subtitleBranches.id, branchId),
          eq(schema.subtitleBranches.status, "open"),
        ),
      )
      .limit(1);
    return branch?.yjsState ?? null;
  }

  const [snapshot] = await db
    .select({ yjsState: schema.snapshots.yjsState })
    .from(schema.snapshots)
    .where(
      and(
        eq(schema.snapshots.episodeId, documentName),
        eq(schema.snapshots.label, LIVE_LABEL),
      ),
    )
    .limit(1);

  if (snapshot) return snapshot.yjsState;

  const cueRows = await db
    .select()
    .from(schema.cues)
    .where(eq(schema.cues.episodeId, documentName))
    .orderBy(asc(schema.cues.orderIndex));

  const seeds: CueSeed[] = cueRows.map((c) => ({
    id: c.id,
    orderIndex: c.orderIndex,
    startMs: c.startMs,
    endMs: c.endMs,
    text: c.text,
    styleName: c.styleName,
    speakerId: c.speakerId,
    confidence: c.confidence,
    needsReview: c.needsReview,
  }));

  const doc = new Y.Doc();
  doc.clientID = SEED_CLIENT_ID;
  hydrateCuesIntoDoc(doc, seeds);
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Upsert the (episode, 'live') snapshot row with the new Y.Doc bytes.
 * Hocuspocus's Database extension calls this on a debounce after document updates.
 */
export async function storeDocumentState(
  documentName: string,
  state: Uint8Array,
): Promise<void> {
  const branchId = branchIdFromDocumentName(documentName);
  if (branchId) {
    const [updated] = await db
      .update(schema.subtitleBranches)
      .set({ yjsState: state, updatedAt: new Date() })
      .where(
        and(
          eq(schema.subtitleBranches.id, branchId),
          eq(schema.subtitleBranches.status, "open"),
        ),
      )
      .returning({ id: schema.subtitleBranches.id });
    if (!updated) throw new Error(`open subtitle branch ${branchId} not found`);
    return;
  }

  await db
    .insert(schema.snapshots)
    .values({
      episodeId: documentName,
      label: LIVE_LABEL,
      yjsState: state,
    })
    .onConflictDoUpdate({
      target: [schema.snapshots.episodeId, schema.snapshots.label],
      set: { yjsState: state, createdAt: new Date() },
    });
}

export const databaseExtension = new Database({
  fetch: async ({ documentName }) => fetchDocumentState(documentName),
  store: async ({ documentName, state }) => {
    await storeDocumentState(documentName, state);
  },
});
