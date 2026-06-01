export type CueKeyAction =
  | { type: 'none' }
  | { type: 'split' }
  | { type: 'insert' }
  | { type: 'newline' }
  | { type: 'move'; direction: 'up' | 'down' }
  | { type: 'nav'; direction: 'prev' | 'next' };

export function classifyCueKeydown(
  e: { key: string; shiftKey: boolean; metaKey: boolean; isComposing: boolean; keyCode: number },
  composing: boolean,
  caretAtEnd: boolean,
): CueKeyAction {
  // IME: skip while a CJK candidate is open. `composing` (CueRow's compositionstart/end
  // flag) is still true on the commit-Enter keydown where `isComposing` can already be
  // false in some Chromium builds; keyCode 229 is the legacy "IME processing" sentinel.
  if (composing || e.isComposing || e.keyCode === 229) return { type: 'none' };
  if (e.metaKey && e.key === 'ArrowUp') return { type: 'move', direction: 'up' };
  if (e.metaKey && e.key === 'ArrowDown') return { type: 'move', direction: 'down' };
  if (e.key === 'Enter') {
    if (e.shiftKey) return { type: 'newline' }; // Shift+Enter -> \N (wins over insert)
    return caretAtEnd ? { type: 'insert' } : { type: 'split' };
  }
  if (e.key === 'Tab') return { type: 'nav', direction: e.shiftKey ? 'prev' : 'next' };
  return { type: 'none' };
}
