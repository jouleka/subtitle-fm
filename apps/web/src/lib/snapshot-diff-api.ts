import type { CueListDiff } from '@subtitle-fm/shared';

export interface SnapshotMeta {
  id: string;
  label: string;
  createdBy: string | null;
  createdAt: string;
}

export interface SnapshotSelection {
  base: string;
  ours: string;
  theirs: string;
}

export interface SnapshotCompareResponse {
  snapshots: {
    base: Pick<SnapshotMeta, 'id' | 'label' | 'createdAt'>;
    ours: Pick<SnapshotMeta, 'id' | 'label' | 'createdAt'>;
    theirs: Pick<SnapshotMeta, 'id' | 'label' | 'createdAt'>;
  };
  diff: CueListDiff;
}

export async function fetchSnapshotDiff(
  apiBase: string,
  episodeId: string,
  selection: SnapshotSelection,
): Promise<SnapshotCompareResponse> {
  const query = new URLSearchParams({
    base: selection.base,
    ours: selection.ours,
    theirs: selection.theirs,
  });
  const response = await fetch(
    `${apiBase}/episodes/${encodeURIComponent(episodeId)}/snapshots/compare?${query}`,
    { credentials: 'include' },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `snapshot_compare_failed_${response.status}`);
  }
  return (await response.json()) as SnapshotCompareResponse;
}
