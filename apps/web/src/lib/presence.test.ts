import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import { userColor, derivePresence, type PresenceState } from './presence';

describe('userColor', () => {
  test('is deterministic for the same id (intent: a user keeps one colour across sessions/tabs without coordination)', () => {
    expect(userColor('user-abc')).toBe(userColor('user-abc'));
  });

  test('returns a valid space-separated hsl() string (intent: must be a usable CSS colour)', () => {
    expect(userColor('user-abc')).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
  });

  test('handles an empty id without throwing (intent: a missing id must not crash presence)', () => {
    expect(userColor('')).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
  });

  test('different ids generally produce different hues (intent: editors should be visually distinguishable)', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e'].map(userColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('derivePresence', () => {
  const u = (id: string, name: string | null = id) => ({ id, name, color: `c-${id}` });
  const states = (entries: [number, PresenceState][]) => new Map<number, PresenceState>(entries);

  test("excludes the self client from roster and byCue (intent: you don't see yourself as a remote editor)", () => {
    const d = derivePresence(
      states([
        [1, { user: u('me'), focusedCueId: 'cue1' }],
        [2, { user: u('them'), focusedCueId: 'cue2' }],
      ]),
      1,
    );
    expect(d.roster.map((p) => p.id)).toEqual(['them']);
    expect([...d.byCue.keys()]).toEqual(['cue2']);
  });

  test('dedupes the roster by user id across connections (intent: one person with two tabs shows once)', () => {
    const d = derivePresence(
      states([
        [2, { user: u('alice'), focusedCueId: 'cue1' }],
        [3, { user: u('alice'), focusedCueId: 'cue2' }],
      ]),
      1,
    );
    expect(d.roster.map((p) => p.id)).toEqual(['alice']);
  });

  test('groups remote users under their focusedCueId (intent: highlight the right rows)', () => {
    const d = derivePresence(
      states([
        [2, { user: u('alice'), focusedCueId: 'cueA' }],
        [3, { user: u('bob'), focusedCueId: 'cueA' }],
      ]),
      1,
    );
    expect(
      d.byCue
        .get('cueA')!
        .map((p) => p.id)
        .sort(),
    ).toEqual(['alice', 'bob']);
  });

  test('a user on two cues via two tabs appears on both cues but once in the roster (intent: per-connection focus, per-person roster)', () => {
    const d = derivePresence(
      states([
        [2, { user: u('alice'), focusedCueId: 'cueA' }],
        [3, { user: u('alice'), focusedCueId: 'cueB' }],
      ]),
      1,
    );
    expect(d.roster).toHaveLength(1);
    expect(d.byCue.get('cueA')!.map((p) => p.id)).toEqual(['alice']);
    expect(d.byCue.get('cueB')!.map((p) => p.id)).toEqual(['alice']);
  });

  test('a user with two tabs on the same cue is listed once on that cue (intent: no duplicate label on one row)', () => {
    const d = derivePresence(
      states([
        [2, { user: u('alice'), focusedCueId: 'cueA' }],
        [3, { user: u('alice'), focusedCueId: 'cueA' }],
      ]),
      1,
    );
    expect(d.byCue.get('cueA')).toHaveLength(1);
  });

  test("ignores states with no user (intent: a connection that hasn't published identity isn't shown)", () => {
    const d = derivePresence(
      states([
        [2, {}],
        [3, { focusedCueId: 'cueA' }],
      ]),
      1,
    );
    expect(d.roster).toEqual([]);
    expect(d.byCue.size).toBe(0);
  });

  test("a user with no focusedCueId is in the roster but on no cue (intent: 'online but not editing a cue')", () => {
    const d = derivePresence(states([[2, { user: u('alice') }]]), 1);
    expect(d.roster.map((p) => p.id)).toEqual(['alice']);
    expect(d.byCue.size).toBe(0);
  });

  test("falls back to 'Anonymous' for a null name (intent: a nameless Discord profile still renders)", () => {
    const d = derivePresence(states([[2, { user: u('alice', null), focusedCueId: 'cueA' }]]), 1);
    expect(d.roster[0]!.name).toBe('Anonymous');
  });

  test('derives a character caret for each remote connection', () => {
    const d = derivePresence(
      states([
        [
          2,
          {
            user: u('alice'),
            focusedCueId: 'cueA',
            textSelection: { cueId: 'cueA', anchor: 3, head: 5 },
          },
        ],
        [
          3,
          {
            user: u('alice'),
            focusedCueId: 'cueA',
            textSelection: { cueId: 'cueA', anchor: 8, head: 8 },
          },
        ],
      ]),
      1,
    );
    expect(d.caretsByCue.get('cueA')).toEqual([
      { ...u('alice'), name: 'alice', clientId: 2, anchor: 3, head: 5 },
      { ...u('alice'), name: 'alice', clientId: 3, anchor: 8, head: 8 },
    ]);
  });

  test('ignores stale or malformed text selections', () => {
    const d = derivePresence(
      states([
        [
          2,
          {
            user: u('alice'),
            focusedCueId: 'cueA',
            textSelection: { cueId: 'cueB', anchor: 1, head: 1 },
          },
        ],
        [
          3,
          {
            user: u('bob'),
            focusedCueId: 'cueA',
            textSelection: { cueId: 'cueA', anchor: -1, head: 2 },
          },
        ],
      ]),
      1,
    );
    expect(d.caretsByCue.size).toBe(0);
  });

  test("excludes the local client's text selection", () => {
    const d = derivePresence(
      states([
        [
          1,
          {
            user: u('me'),
            focusedCueId: 'cueA',
            textSelection: { cueId: 'cueA', anchor: 2, head: 2 },
          },
        ],
      ]),
      1,
    );
    expect(d.caretsByCue.size).toBe(0);
  });
});

test('text selections survive a real Yjs awareness update', () => {
  const sourceDoc = new Y.Doc();
  const targetDoc = new Y.Doc();
  const source = new Awareness(sourceDoc);
  const target = new Awareness(targetDoc);
  try {
    source.setLocalState({
      user: { id: 'alice', name: 'Alice', color: '#123456' },
      focusedCueId: 'cueA',
      textSelection: { cueId: 'cueA', anchor: 4, head: 7 },
    });
    applyAwarenessUpdate(
      target,
      encodeAwarenessUpdate(source, [source.clientID]),
      'presence-test',
    );

    const derived = derivePresence(
      target.getStates() as Map<number, PresenceState>,
      target.clientID,
    );
    expect(derived.caretsByCue.get('cueA')).toEqual([
      {
        id: 'alice',
        name: 'Alice',
        color: '#123456',
        clientId: source.clientID,
        anchor: 4,
        head: 7,
      },
    ]);
  } finally {
    source.destroy();
    target.destroy();
    sourceDoc.destroy();
    targetDoc.destroy();
  }
});
