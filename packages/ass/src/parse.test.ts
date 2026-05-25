import { describe, expect, test } from 'bun:test';
import { parseAss } from './parse';
import { MINIMAL_ASS, OVERRIDE_HEAVY_ASS } from './fixtures';

describe('parseAss', () => {
  test('extracts script info from [Script Info] block', () => {
    const doc = parseAss(MINIMAL_ASS);
    expect(doc.info.Title).toBe('Test');
    expect(doc.info.ScriptType).toBe('v4.00+');
    expect(doc.info.PlayResX).toBe('1920');
    expect(doc.info.PlayResY).toBe('1080');
  });

  test('extracts styles preserving every column as a string', () => {
    const doc = parseAss(MINIMAL_ASS);
    expect(doc.styles).toHaveLength(1);
    const style = doc.styles[0]!;
    expect(style.Name).toBe('Default');
    expect(style.Fontname).toBe('Arial');
    // colors and booleans are strings — that's how libass reads them
    expect(style.PrimaryColour).toBe('&H00FFFFFF');
    expect(style.Bold).toBe('0');
  });

  test('converts dialogue times from seconds to milliseconds', () => {
    const doc = parseAss(MINIMAL_ASS);
    expect(doc.cues).toHaveLength(2);
    expect(doc.cues[0]!.startMs).toBe(1000);
    expect(doc.cues[0]!.endMs).toBe(3500);
    expect(doc.cues[1]!.startMs).toBe(4000);
    expect(doc.cues[1]!.endMs).toBe(6000);
  });

  test('preserves speaker name and style name', () => {
    const doc = parseAss(MINIMAL_ASS);
    expect(doc.cues[0]!.speaker).toBe('');
    expect(doc.cues[1]!.speaker).toBe('Speaker A');
    expect(doc.cues[0]!.styleName).toBe('Default');
  });

  test('preserves override tags verbatim in cue.text (opaque)', () => {
    const doc = parseAss(OVERRIDE_HEAVY_ASS);
    expect(doc.cues).toHaveLength(3);
    // karaoke tags survive
    expect(doc.cues[0]!.text).toContain('{\\k50}');
    expect(doc.cues[0]!.text).toContain('{\\k30}');
    // fad + pos survive together as a single block
    expect(doc.cues[1]!.text).toContain('{\\fad(300,200)\\pos(960,540)}');
    // line break marker survives as the raw escape
    expect(doc.cues[1]!.text).toContain('\\N');
    // transform tag with nested override survives
    expect(doc.cues[2]!.text).toContain('{\\t(0,1000,\\frz360)}');
  });

  test('tolerates empty input without throwing', () => {
    expect(() => parseAss('')).not.toThrow();
  });

  test('empty input yields a usable empty doc', () => {
    const doc = parseAss('');
    expect(doc.cues).toEqual([]);
    expect(doc.styles).toEqual([]);
    expect(doc.info).toEqual({});
  });
});
