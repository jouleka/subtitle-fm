import type { LiveCue } from '@subtitle-fm/shared/yjs';
import type { AppliedCueConflictDecision, CueConflictResolution } from '@subtitle-fm/shared';
import type { SnapshotCompareResponse } from './snapshot-diff-api';

export interface SubtitleBranch {
  id: string;
  episodeId: string;
  name: string;
  baseSnapshotId: string;
  status: 'open' | 'merged' | 'rejected';
  createdBy: string | null;
  mergedBy: string | null;
  rejectedBy: string | null;
  mergeDecisions: AppliedCueConflictDecision[] | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  rejectedAt: string | null;
}

export interface SubtitleBranchDetail extends SubtitleBranch {
  base: { id: string; label: string; createdAt: string };
  cues: LiveCue[];
}

async function jsonOrError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `branch_request_failed_${response.status}`);
  return body;
}

export async function createSubtitleBranch(
  apiBase: string,
  episodeId: string,
  input: { name: string; baseSnapshotId: string },
): Promise<SubtitleBranch> {
  const response = await fetch(`${apiBase}/episodes/${encodeURIComponent(episodeId)}/branches`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  return (await jsonOrError(response)) as unknown as SubtitleBranch;
}

export async function fetchBranchDiff(
  apiBase: string,
  episodeId: string,
  branchId: string,
): Promise<SnapshotCompareResponse> {
  const response = await fetch(
    `${apiBase}/episodes/${encodeURIComponent(episodeId)}/branches/${encodeURIComponent(branchId)}/compare`,
    { credentials: 'include' },
  );
  return (await jsonOrError(response)) as unknown as SnapshotCompareResponse;
}

export async function mergeSubtitleBranch(
  apiBase: string,
  episodeId: string,
  branchId: string,
  resolutions: CueConflictResolution[] = [],
): Promise<void> {
  const response = await fetch(
    `${apiBase}/episodes/${encodeURIComponent(episodeId)}/branches/${encodeURIComponent(branchId)}/merge`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolutions }),
    },
  );
  await jsonOrError(response);
}

export async function rejectSubtitleBranch(
  apiBase: string,
  episodeId: string,
  branchId: string,
): Promise<{ branch: SubtitleBranch; reputationPenalty: number }> {
  const response = await fetch(
    `${apiBase}/episodes/${encodeURIComponent(episodeId)}/branches/${encodeURIComponent(branchId)}/reject`,
    { method: 'POST', credentials: 'include' },
  );
  return (await jsonOrError(response)) as unknown as {
    branch: SubtitleBranch;
    reputationPenalty: number;
  };
}
