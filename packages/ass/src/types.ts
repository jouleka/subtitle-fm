/**
 * Flat domain model used by the editor and DB layer. Maps onto ass-compiler's
 * richer ParsedASS structure on the way in/out (see parse.ts / serialize.ts).
 *
 * Round-trip philosophy: `text` is stored verbatim, including override tags
 * (`{\fad}`, `\k`, `\t(...)`, drawing commands). Override tags are never
 * structurally parsed at this layer — they survive parse → edit → serialize
 * untouched.
 */

export interface AssCue {
  /** Render-order layer (0+). Higher draws on top. */
  layer: number;
  /** Start time, milliseconds since the start of the file. */
  startMs: number;
  /** End time, milliseconds since the start of the file. */
  endMs: number;
  /** Style name; must reference a style in ParsedAss.styles. */
  styleName: string;
  /** Speaker/character name. Empty string if none. */
  speaker: string;
  /** Per-cue left margin override. 0 = use style default. */
  marginL: number;
  /** Per-cue right margin override. 0 = use style default. */
  marginR: number;
  /** Per-cue vertical margin override. 0 = use style default. */
  marginV: number;
  /** Verbatim text including ASS override tags. Treat as opaque in editors. */
  text: string;
}

/**
 * ASS Script Info block — every key/value as it appeared in the source file.
 * Common keys: Title, ScriptType, PlayResX, PlayResY, WrapStyle.
 */
export type AssScriptInfo = Record<string, string>;

/**
 * ASS V4+ Style. Every field stays a string because that's how they round-trip
 * through ass-compiler (colors like `&H00FFFFFF`, booleans like `-1`/`0`).
 */
export type AssStyle = Record<string, string>;

export interface ParsedAss {
  info: AssScriptInfo;
  styles: AssStyle[];
  cues: AssCue[];
}
