export function resolveCollabBase(env: NodeJS.ProcessEnv = process.env): string {
  if (env.COLLAB_INTERNAL_URL) return env.COLLAB_INTERNAL_URL;
  if (env.COLLAB_INTERNAL_HOSTPORT) return `http://${env.COLLAB_INTERNAL_HOSTPORT}`;
  return `http://localhost:${env.COLLAB_PORT ?? 1234}`;
}

const collabBase = resolveCollabBase();

function authHeaders(): HeadersInit {
  const secret = process.env.COLLAB_SECRET;
  if (!secret) throw new Error('COLLAB_SECRET is not configured');
  return { authorization: `Bearer ${secret}` };
}

export async function fetchCurrentDocumentState(episodeId: string): Promise<Uint8Array> {
  const response = await fetch(
    `${collabBase}/internal/documents/${encodeURIComponent(episodeId)}/state`,
    { headers: authHeaders() },
  );
  if (!response.ok) throw new Error(`collab state request failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function fetchBranchDocumentState(branchId: string): Promise<Uint8Array> {
  const documentName = `branch:${branchId}`;
  const response = await fetch(
    `${collabBase}/internal/documents/${encodeURIComponent(documentName)}/state`,
    { headers: authHeaders() },
  );
  if (!response.ok) throw new Error(`collab branch state request failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function restoreCollaborativeSnapshot(
  episodeId: string,
  snapshotId: string,
): Promise<void> {
  const response = await fetch(
    `${collabBase}/internal/documents/${encodeURIComponent(episodeId)}/snapshots/${encodeURIComponent(snapshotId)}/restore`,
    { method: 'POST', headers: authHeaders() },
  );
  if (!response.ok) throw new Error(`collab restore request failed: ${response.status}`);
}
