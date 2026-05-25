import { parse as parseRaw } from 'ass-compiler';
import type { AssCue, ParsedAss } from './types';

/**
 * Parse an ASS / SSA subtitle string into the flat domain model.
 *
 * Comments in the events block are dropped (they're not subtitles).
 *
 * Time precision contract: ASS times are canonically centiseconds (10 ms).
 * We round to ms on the way in (`Math.round(d.Start * 1000)`) and floor to
 * cs on serialize (`formatAssTime`), so a value like `1.234s` in source
 * becomes `1230ms` on round-trip. Don't expect sub-10ms timing accuracy
 * end-to-end.
 */
export function parseAss(raw: string): ParsedAss {
  const parsed = parseRaw(raw);

  const cues: AssCue[] = parsed.events.dialogue.map((d) => ({
    layer: d.Layer,
    startMs: Math.round(d.Start * 1000),
    endMs: Math.round(d.End * 1000),
    styleName: d.Style,
    speaker: d.Name,
    marginL: d.MarginL,
    marginR: d.MarginR,
    marginV: d.MarginV,
    text: d.Text.raw,
  }));

  return {
    info: { ...parsed.info },
    styles: parsed.styles.style.map((s) => ({ ...s })),
    cues,
  };
}
