import { describe, expect, test } from 'bun:test';
import { decorateWithRemoteCarets } from './remote-carets';
import type { RemoteCaret } from './presence';

function caret(clientId: number, head: number): RemoteCaret {
  return {
    id: `user-${clientId}`,
    name: `User ${clientId}`,
    color: `color-${clientId}`,
    clientId,
    anchor: head,
    head,
  };
}

describe('decorateWithRemoteCarets', () => {
  test('inserts a caret at its UTF-16 textarea offset without changing text', () => {
    const decorated = decorateWithRemoteCarets('hello', [caret(2, 2)]);
    expect(decorated.map((item) => item.kind)).toEqual(['text', 'caret', 'text']);
    expect(
      decorated
        .filter((item) => item.kind !== 'caret')
        .map((item) => item.value)
        .join(''),
    ).toBe('hello');
  });

  test('keeps ASS override-tag highlighting when a caret splits a tag', () => {
    const decorated = decorateWithRemoteCarets('a{\\i1}b', [caret(2, 4)]);
    expect(decorated).toEqual([
      { kind: 'text', value: 'a' },
      { kind: 'tag', value: '{\\i' },
      { kind: 'caret', caret: caret(2, 4) },
      { kind: 'tag', value: '1}' },
      { kind: 'text', value: 'b' },
    ]);
  });

  test('clamps stale remote offsets to the current text bounds', () => {
    const decorated = decorateWithRemoteCarets('abc', [caret(2, -4), caret(3, 99)]);
    expect(decorated[0]).toEqual({ kind: 'caret', caret: caret(2, -4) });
    expect(decorated.at(-1)).toEqual({ kind: 'caret', caret: caret(3, 99) });
  });

  test('orders multiple carets at one offset by awareness client id', () => {
    const decorated = decorateWithRemoteCarets('ab', [caret(9, 1), caret(3, 1)]);
    expect(
      decorated.filter((item) => item.kind === 'caret').map((item) => item.caret.clientId),
    ).toEqual([3, 9]);
  });

  test('never splits an emoji when a stale offset lands inside its surrogate pair', () => {
    const decorated = decorateWithRemoteCarets('a😀b', [caret(2, 2)]);
    expect(
      decorated
        .filter((item) => item.kind !== 'caret')
        .map((item) => item.value)
        .join(''),
    ).toBe('a😀b');
    expect(decorated.map((item) => item.kind)).toEqual(['text', 'caret', 'text']);
    expect(decorated[0]).toEqual({ kind: 'text', value: 'a😀' });
  });

  test('renders carets in an empty cue', () => {
    expect(decorateWithRemoteCarets('', [caret(2, 0)])).toEqual([
      { kind: 'caret', caret: caret(2, 0) },
    ]);
  });
});
