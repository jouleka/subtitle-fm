export interface PresenceUser {
  id: string;
  name: string;
  color: string;
}

export interface TextSelection {
  cueId: string;
  anchor: number;
  head: number;
}

export interface RemoteCaret extends PresenceUser {
  clientId: number;
  anchor: number;
  head: number;
}

/** The awareness local-state shape this app publishes. */
export interface PresenceState {
  user?: { id: string; name: string | null; color: string };
  focusedCueId?: string | null;
  textSelection?: TextSelection | null;
}

export interface DerivedPresence {
  roster: PresenceUser[];
  byCue: Map<string, PresenceUser[]>;
  caretsByCue: Map<string, RemoteCaret[]>;
}

function validSelection(value: TextSelection | null | undefined): value is TextSelection {
  return (
    !!value &&
    typeof value.cueId === 'string' &&
    value.cueId.length > 0 &&
    Number.isFinite(value.anchor) &&
    Number.isFinite(value.head) &&
    value.anchor >= 0 &&
    value.head >= 0
  );
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
 * excluded), a focusedCueId → users map, and per-connection character carets.
 * States with no valid user are ignored. The same user across two connections
 * appears once in the roster, while each connection keeps its own caret.
 * Differing payloads for one user are last-write-wins on the roster entry
 * (payloads are identical per id in practice).
 */
export function derivePresence(
  states: Map<number, PresenceState>,
  selfClientId: number,
): DerivedPresence {
  const rosterById = new Map<string, PresenceUser>();
  const byCue = new Map<string, PresenceUser[]>();
  const caretsByCue = new Map<string, RemoteCaret[]>();

  for (const [clientId, state] of states) {
    if (clientId === selfClientId) continue;
    const u = state?.user;
    if (!u || typeof u.id !== 'string') continue;

    const presenceUser: PresenceUser = {
      id: u.id,
      name: u.name ?? 'Anonymous',
      color: u.color ?? userColor(u.id),
    };
    rosterById.set(u.id, presenceUser);

    const cueId = state.focusedCueId;
    if (typeof cueId === 'string') {
      const arr = byCue.get(cueId) ?? [];
      if (!arr.some((p) => p.id === presenceUser.id)) arr.push(presenceUser);
      byCue.set(cueId, arr);
    }

    const selection = state.textSelection;
    if (validSelection(selection) && selection.cueId === cueId) {
      const arr = caretsByCue.get(selection.cueId) ?? [];
      arr.push({
        ...presenceUser,
        clientId,
        anchor: Math.floor(selection.anchor),
        head: Math.floor(selection.head),
      });
      caretsByCue.set(selection.cueId, arr);
    }
  }

  return { roster: [...rosterById.values()], byCue, caretsByCue };
}
