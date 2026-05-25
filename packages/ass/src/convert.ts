import type { ParsedAss } from './types';

/**
 * Matches an ASS override block: `{...}`. ASS does not support nested or
 * escaped braces inside override blocks — libass treats the first `}` as the
 * terminator — so a non-greedy match between literal braces is sufficient.
 */
const OVERRIDE_TAG_RE = /\{[^}]*\}/g;
/** Non-breaking space escape: ASS `\h` → Unicode U+00A0. */
const NBSP_RE = /\\h/g;
/**
 * ASS line breaks: `\N` (hard, always wraps) and `\n` (soft, wraps only if
 * WrapStyle=2). For SRT/VTT we collapse both to a literal newline — the
 * wrap-style distinction has no equivalent in either output format and most
 * players ignore it.
 */
const LINE_BREAK_RE = /\\[Nn]/g;

/**
 * Strip ASS override tags and convert in-text escape sequences (`\h`, `\N`,
 * `\n`) to their plain-text equivalents. Order matters: drop override blocks
 * first so we don't accidentally match `\h` / `\N` inside one.
 */
function stripAssTags(text: string): string {
  return text.replace(OVERRIDE_TAG_RE, '').replace(NBSP_RE, ' ').replace(LINE_BREAK_RE, '\n');
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0');
}

/** `HH:MM:SS,mmm` per SRT spec. */
function formatSrtTime(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const millis = safe % 1000;
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(millis)}`;
}

/** `HH:MM:SS.mmm` per WebVTT spec — dot instead of comma. */
function formatVttTime(ms: number): string {
  return formatSrtTime(ms).replace(',', '.');
}

/**
 * Convert to SubRip (.srt). Strips override tags, maps `\h`/`\N`/`\n`,
 * numbers cues from 1.
 *
 * Line endings: LF only. The SRT spec is CRLF, but VLC, mpv, Plex, Jellyfin,
 * and modern browser TextTrack parsers all accept LF. Pinning LF avoids
 * needing platform-specific output and is verified by the convert.test.ts
 * "uses LF line endings" test.
 */
export function toSrt(doc: ParsedAss): string {
  return (
    doc.cues
      .map(
        (cue, i) =>
          `${i + 1}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${stripAssTags(cue.text)}`,
      )
      .join('\n\n') + '\n'
  );
}

/**
 * Convert to WebVTT (.vtt). Always emits the `WEBVTT` header — players reject
 * files without it. LF line endings (WebVTT spec accepts both).
 */
export function toVtt(doc: ParsedAss): string {
  const body = doc.cues
    .map(
      (cue) =>
        `${formatVttTime(cue.startMs)} --> ${formatVttTime(cue.endMs)}\n${stripAssTags(cue.text)}`,
    )
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}
