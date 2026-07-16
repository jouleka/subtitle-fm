export type ShowRole = 'tl' | 'tlc' | 'ed' | 'ts' | 'qc';

export interface ShowAccess {
  reputation: number;
  globalRole: 'anon' | 'editor' | 'translator' | 'reviewer' | 'admin';
  showRole: ShowRole | null;
  thresholds: { merge: number; publish: number };
  canSuggest: boolean;
  canMerge: boolean;
  canPublish: boolean;
}

export async function fetchShowAccess(
  apiBase: string,
  showId: string,
): Promise<ShowAccess> {
  const response = await fetch(`${apiBase}/shows/${encodeURIComponent(showId)}/access`, {
    credentials: 'include',
  });
  const body = (await response.json().catch(() => ({}))) as ShowAccess & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `show_access_failed_${response.status}`);
  return body;
}
