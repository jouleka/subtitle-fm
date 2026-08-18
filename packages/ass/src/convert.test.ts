import { describe, expect, test } from 'bun:test';
import { parseAss } from './parse';
import { toSrt, toVtt } from './convert';
import { MINIMAL_ASS, OVERRIDE_HEAVY_ASS } from './fixtures';

describe('toSrt', () => {
  test('numbers cues starting at 1', () => {
    const out = toSrt(parseAss(MINIMAL_ASS));
    const lines = out.split('\n');
    expect(lines[0]).toBe('1');
  });

  test('emits HH:MM:SS,mmm timestamps with comma separator', () => {
    const out = toSrt(parseAss(MINIMAL_ASS));
    expect(out).toContain('00:00:01,000 --> 00:00:03,500');
    expect(out).toContain('00:00:04,000 --> 00:00:06,000');
  });

  test('strips ASS override tags', () => {
    const out = toSrt(parseAss(OVERRIDE_HEAVY_ASS));
    expect(out).not.toContain('{\\k');
    expect(out).not.toContain('{\\fad');
    expect(out).not.toContain('{\\t(');
    expect(out).not.toContain('{\\pos');
    // text content after the tags survives
    expect(out).toContain('Karaoke line');
    expect(out).toContain('Spinning text');
  });

  test('strips multiple override blocks in a forward pass and preserves unmatched braces', () => {
    const doc = parseAss(MINIMAL_ASS);
    doc.cues[0]!.text = '{\\b1}bold{\\b0} and a literal { brace';
    const out = toSrt(doc);
    expect(out).toContain('bold and a literal { brace');
  });

  test('converts \\N line breaks to literal newlines', () => {
    const out = toSrt(parseAss(OVERRIDE_HEAVY_ASS));
    expect(out).toContain('With\nline break');
    expect(out).not.toContain('\\N');
  });

  test('separates cues with a blank line', () => {
    const out = toSrt(parseAss(MINIMAL_ASS));
    // Cue 1 block, blank line, cue 2 block
    expect(out).toMatch(/Hello world\n\n2\n/);
  });

  test('trailing newline', () => {
    const out = toSrt(parseAss(MINIMAL_ASS));
    expect(out.endsWith('\n')).toBe(true);
  });

  test('uses LF line endings (pinned — see toSrt JSDoc)', () => {
    const out = toSrt(parseAss(MINIMAL_ASS));
    expect(out).not.toContain('\r');
  });

  test('converts ASS \\h to NBSP (U+00A0)', () => {
    const doc = parseAss(MINIMAL_ASS);
    doc.cues[0]!.text = 'spaced\\hword';
    const out = toSrt(doc);
    expect(out).toContain('spaced word');
    expect(out).not.toContain('\\h');
  });
});

describe('toVtt', () => {
  test('emits required WEBVTT header', () => {
    const out = toVtt(parseAss(MINIMAL_ASS));
    expect(out.startsWith('WEBVTT\n\n')).toBe(true);
  });

  test('emits HH:MM:SS.mmm timestamps with dot separator', () => {
    const out = toVtt(parseAss(MINIMAL_ASS));
    expect(out).toContain('00:00:01.000 --> 00:00:03.500');
    expect(out).not.toContain('00:00:01,000');
  });

  test('omits SRT-style numbering', () => {
    const out = toVtt(parseAss(MINIMAL_ASS));
    // Right after WEBVTT header should be a timestamp, not "1\n"
    const afterHeader = out.split('\n\n')[1] ?? '';
    expect(afterHeader.startsWith('00:')).toBe(true);
  });

  test('strips override tags and converts line breaks', () => {
    const out = toVtt(parseAss(OVERRIDE_HEAVY_ASS));
    expect(out).not.toContain('{\\fad');
    expect(out).toContain('With\nline break');
  });
});
