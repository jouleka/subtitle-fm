import { describe, expect, test } from 'bun:test';
import { parseAss } from './parse';
import { serializeAss } from './serialize';
import { MINIMAL_ASS, OVERRIDE_HEAVY_ASS } from './fixtures';

describe('serializeAss', () => {
  test('emits valid ASS sections', () => {
    const doc = parseAss(MINIMAL_ASS);
    const out = serializeAss(doc);
    expect(out).toContain('[Script Info]');
    expect(out).toContain('[V4+ Styles]');
    expect(out).toContain('[Events]');
    expect(out).toContain('Format:');
    expect(out).toContain('Dialogue:');
  });

  test('round-trip preserves cue count, timing, and text', () => {
    const before = parseAss(MINIMAL_ASS);
    const after = parseAss(serializeAss(before));

    expect(after.cues).toHaveLength(before.cues.length);
    for (let i = 0; i < before.cues.length; i++) {
      expect(after.cues[i]!.startMs).toBe(before.cues[i]!.startMs);
      expect(after.cues[i]!.endMs).toBe(before.cues[i]!.endMs);
      expect(after.cues[i]!.text).toBe(before.cues[i]!.text);
      expect(after.cues[i]!.styleName).toBe(before.cues[i]!.styleName);
      expect(after.cues[i]!.speaker).toBe(before.cues[i]!.speaker);
    }
  });

  test('round-trip preserves override tags verbatim — karaoke, fad, transforms, line breaks', () => {
    const before = parseAss(OVERRIDE_HEAVY_ASS);
    const after = parseAss(serializeAss(before));

    expect(after.cues[0]!.text).toBe(before.cues[0]!.text);
    expect(after.cues[1]!.text).toBe(before.cues[1]!.text);
    expect(after.cues[2]!.text).toBe(before.cues[2]!.text);
  });

  test('round-trip preserves Script Info keys', () => {
    const before = parseAss(MINIMAL_ASS);
    const after = parseAss(serializeAss(before));
    expect(after.info.Title).toBe(before.info.Title);
    expect(after.info.PlayResX).toBe(before.info.PlayResX);
    expect(after.info.PlayResY).toBe(before.info.PlayResY);
  });

  test('edits to cue text survive serialize → parse round-trip', () => {
    const doc = parseAss(MINIMAL_ASS);
    doc.cues[0]!.text = 'Edited line';
    doc.cues[0]!.startMs = 1500;
    const after = parseAss(serializeAss(doc));
    expect(after.cues[0]!.text).toBe('Edited line');
    expect(after.cues[0]!.startMs).toBe(1500);
  });

  test('stable across three serialize/parse cycles', () => {
    const first = serializeAss(parseAss(MINIMAL_ASS));
    const second = serializeAss(parseAss(first));
    const third = serializeAss(parseAss(second));
    expect(second).toBe(first);
    expect(third).toBe(second);
  });

  test('throws on comma in cue.speaker (would silently corrupt downstream parse)', () => {
    const doc = parseAss(MINIMAL_ASS);
    doc.cues[0]!.speaker = 'Smith, John';
    expect(() => serializeAss(doc)).toThrow(/speaker cannot contain a comma/);
  });

  test('throws on comma in cue.styleName', () => {
    const doc = parseAss(MINIMAL_ASS);
    doc.cues[0]!.styleName = 'Bad,Style';
    expect(() => serializeAss(doc)).toThrow(/styleName cannot contain a comma/);
  });

  test('throws on literal newline in cue.text (must use \\N or \\n)', () => {
    const doc = parseAss(MINIMAL_ASS);
    doc.cues[0]!.text = 'line one\nline two';
    expect(() => serializeAss(doc)).toThrow(/literal newline/);
  });
});
