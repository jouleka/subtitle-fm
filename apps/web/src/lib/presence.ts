export interface PresenceUser {
  id: string;
  name: string;
  color: string;
}

/** The awareness local-state shape this app publishes. */
export interface PresenceState {
  user?: { id: string; name: string | null; color: string };
  focusedCueId?: string | null;
}

export interface DerivedPresence {
  roster: PresenceUser[];
  byCue: Map<string, PresenceUser[]>;
}

/**
 * Deterministic presence colour from a user id: hash → hue, fixed S/L for
 * legible, distinct chips. Same id always yields the same colour; no
 * cross-client coordination needed. Empty id hashes to hue 0 (still valid).
 */
export function userColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 45%)`;
}

/**
 * Pure transform of awareness states into a roster (deduped by user id, self
 * excluded) and a focusedCueId → users map (self excluded). States with no
 * valid user are ignored. The same user across two connections appears once
 * in the roster, and on each cue any of their connections focuses (deduped
 * within a single cue). Differing payloads for one user are last-write-wins
 * on the roster entry (payloads are identical per id in practice).
 */
export function derivePresence(
  states: Map<number, PresenceState>,
  selfClientId: number,
): DerivedPresence {
  const rosterById = new Map<string, PresenceUser>();
  const byCue = new Map<string, PresenceUser[]>();

  for (const [clientId, state] of states) {
    if (clientId === selfClientId) continue;
    const u = state?.user;
    if (!u || typeof u.id !== "string") continue;

    const presenceUser: PresenceUser = {
      id: u.id,
      name: u.name ?? "Anonymous",
      color: u.color ?? userColor(u.id),
    };
    rosterById.set(u.id, presenceUser);

    const cueId = state.focusedCueId;
    if (typeof cueId === "string") {
      const arr = byCue.get(cueId) ?? [];
      if (!arr.some((p) => p.id === presenceUser.id)) arr.push(presenceUser);
      byCue.set(cueId, arr);
    }
  }

  return { roster: [...rosterById.values()], byCue };
}
