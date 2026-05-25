import type { ParsedAss } from './types';

/**
 * V4+ Styles column order — libass canonical. Deviating breaks players that
 * read the format line strictly.
 */
const STYLE_FORMAT = [
  'Name',
  'Fontname',
  'Fontsize',
  'PrimaryColour',
  'SecondaryColour',
  'OutlineColour',
  'BackColour',
  'Bold',
  'Italic',
  'Underline',
  'StrikeOut',
  'ScaleX',
  'ScaleY',
  'Spacing',
  'Angle',
  'BorderStyle',
  'Outline',
  'Shadow',
  'Alignment',
  'MarginL',
  'MarginR',
  'MarginV',
  'Encoding',
] as const;

/**
 * [Events] column order. `Text` is last — ASS treats everything after the
 * 9th column separator as Text, so commas inside override tags are safe.
 */
const EVENT_FORMAT = [
  'Layer',
  'Start',
  'End',
  'Style',
  'Name',
  'MarginL',
  'MarginR',
  'MarginV',
  'Effect',
  'Text',
] as const;

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * ASS time format: `H:MM:SS.CC` (centiseconds, 2 digits). Matches
 * ass-compiler's parse() input expectations so a round-trip survives.
 */
function formatAssTime(ms: number): string {
  const totalCs = Math.round(Math.max(0, ms) / 10);
  const cs = totalCs % 100;
  const totalSeconds = Math.floor(totalCs / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${hours}:${pad2(minutes)}:${pad2(seconds)}.${pad2(cs)}`;
}

/**
 * Serialize a ParsedAss back to ASS text. We do this directly (rather than
 * via ass-compiler.stringify) so cue.text passes through verbatim —
 * stringify expects a pre-parsed Text.parsed[] structure and silently drops
 * raw text.
 *
 * Drops anything we don't track at the cue level (per-cue Effects, Comment
 * events). The pipeline never emits these.
 */
export function serializeAss(doc: ParsedAss): string {
  const lines: string[] = [];

  lines.push('[Script Info]');
  for (const [key, value] of Object.entries(doc.info)) {
    if (value !== null && value !== undefined) lines.push(`${key}: ${value}`);
  }
  lines.push('');

  lines.push('[V4+ Styles]');
  lines.push(`Format: ${STYLE_FORMAT.join(', ')}`);
  for (const style of doc.styles) {
    const cols = STYLE_FORMAT.map((field) => style[field] ?? '');
    lines.push(`Style: ${cols.join(',')}`);
  }
  lines.push('');

  lines.push('[Events]');
  lines.push(`Format: ${EVENT_FORMAT.join(', ')}`);
  for (let i = 0; i < doc.cues.length; i++) {
    const cue = doc.cues[i]!;
    // Fail loud (Rule 12): ASS has no escape mechanism for commas inside
    // non-Text columns or literal newlines inside Text. A silent comma in
    // a speaker name would shift every later column into Text on re-parse;
    // a literal \n in text breaks the line entirely.
    if (cue.styleName.includes(',')) {
      throw new Error(`cue[${i}].styleName cannot contain a comma: ${JSON.stringify(cue.styleName)}`);
    }
    if (cue.speaker.includes(',')) {
      throw new Error(`cue[${i}].speaker cannot contain a comma: ${JSON.stringify(cue.speaker)}`);
    }
    if (/[\r\n]/.test(cue.text)) {
      throw new Error(`cue[${i}].text contains a literal newline; use \\N (hard) or \\n (soft) instead`);
    }

    const cols: string[] = [
      String(cue.layer),
      formatAssTime(cue.startMs),
      formatAssTime(cue.endMs),
      cue.styleName,
      cue.speaker,
      String(cue.marginL),
      String(cue.marginR),
      String(cue.marginV),
      '', // Effect (always empty — we don't model it)
      cue.text,
    ];
    lines.push(`Dialogue: ${cols.join(',')}`);
  }
  lines.push('');

  return lines.join('\n');
}
