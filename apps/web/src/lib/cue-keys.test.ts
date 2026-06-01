import { expect, test } from 'bun:test';
import { classifyCueKeydown } from './cue-keys';

function ev(
  over: Partial<{
    key: string;
    shiftKey: boolean;
    metaKey: boolean;
    isComposing: boolean;
    keyCode: number;
  }> = {},
) {
  return { key: '', shiftKey: false, metaKey: false, isComposing: false, keyCode: 0, ...over };
}

test('Enter (no shift) splits', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter' }), false)).toEqual({ type: 'split' });
});
test('Shift+Enter is none (falls through to a newline)', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter', shiftKey: true }), false)).toEqual({ type: 'none' });
});
test('Tab navigates next, Shift+Tab navigates previous', () => {
  expect(classifyCueKeydown(ev({ key: 'Tab' }), false)).toEqual({ type: 'nav', direction: 'next' });
  expect(classifyCueKeydown(ev({ key: 'Tab', shiftKey: true }), false)).toEqual({
    type: 'nav',
    direction: 'prev',
  });
});
test('Cmd+ArrowUp/Down move the cue', () => {
  expect(classifyCueKeydown(ev({ key: 'ArrowUp', metaKey: true }), false)).toEqual({
    type: 'move',
    direction: 'up',
  });
  expect(classifyCueKeydown(ev({ key: 'ArrowDown', metaKey: true }), false)).toEqual({
    type: 'move',
    direction: 'down',
  });
});
test('a plain character key is none', () => {
  expect(classifyCueKeydown(ev({ key: 'a' }), false)).toEqual({ type: 'none' });
});
test('Arrow without Cmd is none (left to the textarea / timing-nudge handlers)', () => {
  expect(classifyCueKeydown(ev({ key: 'ArrowUp' }), false)).toEqual({ type: 'none' });
});
test('the composing flag wins even on Enter (never act mid-IME)', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter' }), true)).toEqual({ type: 'none' });
});
test('isComposing on the event is none', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter', isComposing: true }), false)).toEqual({
    type: 'none',
  });
});
test('the legacy IME keyCode 229 (commit-Enter) never splits', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter', keyCode: 229 }), false)).toEqual({ type: 'none' });
});
