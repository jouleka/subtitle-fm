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

test('Enter (no shift) not at the text end splits', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter' }), false, false)).toEqual({ type: 'split' });
});
test('Enter (no shift) at the text end inserts a new cue', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter' }), false, true)).toEqual({ type: 'insert' });
});
test('Shift+Enter is a newline action (CueRow inserts the ass \\N hard break, not a literal newline)', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter', shiftKey: true }), false, false)).toEqual({ type: 'newline' });
});
test('Shift+Enter at the text end is still a newline (shift wins over insert)', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter', shiftKey: true }), false, true)).toEqual({ type: 'newline' });
});
test('Tab navigates next, Shift+Tab navigates previous', () => {
  expect(classifyCueKeydown(ev({ key: 'Tab' }), false, false)).toEqual({ type: 'nav', direction: 'next' });
  expect(classifyCueKeydown(ev({ key: 'Tab', shiftKey: true }), false, false)).toEqual({
    type: 'nav',
    direction: 'prev',
  });
});
test('Cmd+ArrowUp/Down move the cue', () => {
  expect(classifyCueKeydown(ev({ key: 'ArrowUp', metaKey: true }), false, false)).toEqual({
    type: 'move',
    direction: 'up',
  });
  expect(classifyCueKeydown(ev({ key: 'ArrowDown', metaKey: true }), false, false)).toEqual({
    type: 'move',
    direction: 'down',
  });
});
test('a plain character key is none', () => {
  expect(classifyCueKeydown(ev({ key: 'a' }), false, false)).toEqual({ type: 'none' });
});
test('Arrow without Cmd is none (left to the textarea / timing-nudge handlers)', () => {
  expect(classifyCueKeydown(ev({ key: 'ArrowUp' }), false, false)).toEqual({ type: 'none' });
});
test('the composing flag wins even on Enter at the end (never act mid-IME)', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter' }), true, true)).toEqual({ type: 'none' });
});
test('isComposing on the event is none, even at the text end', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter', isComposing: true }), false, true)).toEqual({
    type: 'none',
  });
});
test('the legacy IME keyCode 229 (commit-Enter) never inserts/splits, even at the end', () => {
  expect(classifyCueKeydown(ev({ key: 'Enter', keyCode: 229 }), false, true)).toEqual({ type: 'none' });
});
