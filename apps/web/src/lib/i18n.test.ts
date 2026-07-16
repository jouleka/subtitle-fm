import { describe, expect, test } from 'bun:test';
import en from '../../messages/en.json';
import es from '../../messages/es.json';

const messageEntries = (messages: Record<string, string>) =>
  Object.entries(messages).filter(([key]) => key !== '$schema');

describe('editor translations (SFM-45)', () => {
  test('English and Spanish expose the exact same message keys', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  test('every message is present and non-empty in both locales', () => {
    for (const [key, value] of [...messageEntries(en), ...messageEntries(es)]) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  test('the first non-English editor locale contains translated core actions', () => {
    expect(es.editor_publish).toBe('Publicar');
    expect(es.editor_add_cue).toBe('+ Añadir línea');
    expect(es.editor_glossary).toBe('Glosario');
    expect(es.cue_mark_reviewed).toBe('Marcar como revisada');
  });
});
