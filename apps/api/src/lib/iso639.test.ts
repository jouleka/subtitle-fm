import { expect, test } from 'bun:test';
import { toIso639_2 } from './iso639';

test('maps common ISO-639-1 codes to ISO-639-2', () => {
  expect(toIso639_2('en')).toBe('eng');
  expect(toIso639_2('ja')).toBe('jpn');
  expect(toIso639_2('es')).toBe('spa');
  expect(toIso639_2('ko')).toBe('kor');
});
test('uses the bibliographic (B) variant where B and T differ', () => {
  expect(toIso639_2('de')).toBe('ger');
  expect(toIso639_2('fr')).toBe('fre');
  expect(toIso639_2('zh')).toBe('chi');
  expect(toIso639_2('nl')).toBe('dut');
  expect(toIso639_2('el')).toBe('gre');
  expect(toIso639_2('cs')).toBe('cze');
  expect(toIso639_2('fa')).toBe('per');
  expect(toIso639_2('is')).toBe('ice');
  expect(toIso639_2('ro')).toBe('rum');
  expect(toIso639_2('sk')).toBe('slo');
});
test('lower-cases and trims input', () => {
  expect(toIso639_2('EN')).toBe('eng');
  expect(toIso639_2(' Ja ')).toBe('jpn');
});
test('passes unmapped codes through unchanged (incl. already-3-letter)', () => {
  expect(toIso639_2('eng')).toBe('eng');
  expect(toIso639_2('xx')).toBe('xx');
  expect(toIso639_2('zz')).toBe('zz');
});
