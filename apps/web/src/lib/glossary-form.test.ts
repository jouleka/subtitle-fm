import { expect, test } from 'bun:test';
import { buildTermPayload, type TermFormFields } from './glossary-form';

const fields = (over: Partial<TermFormFields> = {}): TermFormFields => ({
  sourceText: '  Sharingan  ',
  targetText: '  Mirror Wheel Eye  ',
  kind: 'attack',
  notes: '  see ep 12  ',
  ...over,
});

test('create payload includes trimmed sourceText and targetText so the identity/headword is clean', () => {
  expect(buildTermPayload('create', fields())).toEqual({
    sourceText: 'Sharingan',
    targetText: 'Mirror Wheel Eye',
    kind: 'attack',
    notes: 'see ep 12',
  });
});

test('edit payload omits sourceText so the body stays within UpdateGlossaryTerm (identity key is immutable)', () => {
  const p = buildTermPayload('edit', fields());
  expect(p).toEqual({ targetText: 'Mirror Wheel Eye', kind: 'attack', notes: 'see ep 12' });
  expect('sourceText' in p).toBe(false);
});

test('blank or whitespace-only notes become null rather than an empty string', () => {
  expect(buildTermPayload('create', fields({ notes: '   ' })).notes).toBeNull();
  expect(buildTermPayload('edit', fields({ notes: '' })).notes).toBeNull();
});

test('kind passes through unchanged', () => {
  expect(buildTermPayload('edit', fields({ kind: 'honorific' })).kind).toBe('honorific');
});
