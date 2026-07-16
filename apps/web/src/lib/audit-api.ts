export interface CueAuditEvent {
  id: string;
  episodeId: string;
  cueId: string;
  userId: string | null;
  userHandle: string | null;
  fieldChanged: string;
  oldValue: unknown;
  newValue: unknown;
  ts: string;
}

async function jsonOrError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `audit_request_failed_${response.status}`);
  return body;
}

export async function fetchCueAudit(
  apiBase: string,
  episodeId: string,
  cueId: string,
  limit = 5,
): Promise<CueAuditEvent[]> {
  const response = await fetch(
    `${apiBase}/episodes/${encodeURIComponent(episodeId)}/audit/cues/${encodeURIComponent(cueId)}?limit=${limit}`,
    { credentials: 'include' },
  );
  return ((await jsonOrError(response)) as unknown as { events: CueAuditEvent[] }).events;
}

export async function fetchEpisodeAudit(
  apiBase: string,
  episodeId: string,
  options: { limit?: number; before?: string; beforeId?: string } = {},
): Promise<{
  events: CueAuditEvent[];
  hasMore: boolean;
  nextBefore: string | null;
  nextBeforeId: string | null;
}> {
  const query = new URLSearchParams({ limit: String(options.limit ?? 50) });
  if (options.before) query.set('before', options.before);
  if (options.beforeId) query.set('beforeId', options.beforeId);
  const response = await fetch(
    `${apiBase}/episodes/${encodeURIComponent(episodeId)}/audit?${query}`,
    { credentials: 'include' },
  );
  return (await jsonOrError(response)) as unknown as {
    events: CueAuditEvent[];
    hasMore: boolean;
    nextBefore: string | null;
    nextBeforeId: string | null;
  };
}

export function auditValue(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'string') return value || 'empty';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
