const collabBase =
  process.env.COLLAB_INTERNAL_URL ?? `http://localhost:${process.env.COLLAB_PORT ?? 1234}`;

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
