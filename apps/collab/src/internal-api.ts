import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Hocuspocus } from '@hocuspocus/server';
import { and, eq, ne } from 'drizzle-orm';
import { schema } from '@subtitle-fm/db';
import { liveCuesFromSnapshot, replaceCuesInDoc } from '@subtitle-fm/shared/yjs';
import * as Y from 'yjs';
import { db } from './db';
import { branchIdFromDocumentName } from './persistence';

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function authorized(request: IncomingMessage): boolean {
  const secret = process.env.COLLAB_SECRET;
  return Boolean(secret && request.headers.authorization === `Bearer ${secret}`);
}

export async function currentDocumentState(
  instance: Hocuspocus,
  documentName: string,
): Promise<Uint8Array | null> {
  const branchId = branchIdFromDocumentName(documentName);
  if (branchId) {
    const [branch] = await db
      .select({ id: schema.subtitleBranches.id })
      .from(schema.subtitleBranches)
      .where(
        and(
          eq(schema.subtitleBranches.id, branchId),
          eq(schema.subtitleBranches.status, 'open'),
        ),
      )
      .limit(1);
    if (!branch) return null;
  } else {
    const [episode] = await db
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .where(eq(schema.episodes.id, documentName))
      .limit(1);
    if (!episode) return null;
  }

  const connection = await instance.openDirectConnection(documentName);
  try {
    return Y.encodeStateAsUpdate(connection.document!);
  } finally {
    await connection.disconnect();
  }
}

export async function restoreDocumentState(
  instance: Hocuspocus,
  episodeId: string,
  snapshotId: string,
): Promise<{ label: string } | null> {
  const [snapshot] = await db
    .select({ label: schema.snapshots.label, yjsState: schema.snapshots.yjsState })
    .from(schema.snapshots)
    .where(
      and(
        eq(schema.snapshots.id, snapshotId),
        eq(schema.snapshots.episodeId, episodeId),
        ne(schema.snapshots.label, 'live'),
      ),
    )
    .limit(1);
  if (!snapshot) return null;

  const cues = liveCuesFromSnapshot(snapshot.yjsState);
  const connection = await instance.openDirectConnection(episodeId);
  try {
    await connection.transact((document) => replaceCuesInDoc(document, cues));
  } finally {
    await connection.disconnect();
  }
  return { label: snapshot.label };
}

/** Internal HTTP bridge used by the API for exact milestone capture/restore. */
export async function handleInternalRequest(
  request: IncomingMessage,
  response: ServerResponse,
  instance: Hocuspocus,
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://collab.internal');
  const stateMatch = url.pathname.match(/^\/internal\/documents\/([^/]+)\/state$/);
  const restoreMatch = url.pathname.match(
    /^\/internal\/documents\/([^/]+)\/snapshots\/([^/]+)\/restore$/,
  );
  if (!stateMatch && !restoreMatch) return false;
  if (!authorized(request)) {
    sendJson(response, 401, { error: 'unauthorized' });
    return true;
  }

  if (stateMatch && request.method === 'GET') {
    const state = await currentDocumentState(instance, decodeURIComponent(stateMatch[1]!));
    if (!state) sendJson(response, 404, { error: 'episode_not_found' });
    else {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(Buffer.from(state));
    }
    return true;
  }

  if (restoreMatch && request.method === 'POST') {
    const restored = await restoreDocumentState(
      instance,
      decodeURIComponent(restoreMatch[1]!),
      decodeURIComponent(restoreMatch[2]!),
    );
    if (!restored) sendJson(response, 404, { error: 'snapshot_not_found' });
    else sendJson(response, 200, { restored: true, label: restored.label });
    return true;
  }

  sendJson(response, 405, { error: 'method_not_allowed' });
  return true;
}
