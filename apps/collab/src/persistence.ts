import { Database } from "@hocuspocus/extension-database";
import { db } from "./db";
import { schema } from "@subtitle-fm/db";
import { and, asc, eq } from "drizzle-orm";
import * as Y from "yjs";
import { hydrateCuesIntoDoc, type CueSeed } from "@subtitle-fm/shared/yjs";

const LIVE_LABEL = "live";

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
    rawOverrideTags: c.rawOverrideTags,
    styleName: c.styleName,
    speakerId: c.speakerId,
    confidence: c.confidence,
    needsReview: c.needsReview,
  }));

  const doc = new Y.Doc();
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
