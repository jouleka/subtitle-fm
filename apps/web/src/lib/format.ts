/**
 * Render milliseconds as "mm:ss.xx" (e.g., 75_500 → "01:15.50").
 * Hundredths are floored — we never want a timestamp displayed past
 * the actual position.
 */
export function formatMs(ms: number): string {
  const totalCs = Math.floor(ms / 10); // centiseconds
  const minutes = Math.floor(totalCs / 6000);
  const seconds = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${pad2(minutes)}:${pad2(seconds)}.${pad2(cs)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Parse "mm:ss.xx" (the formatMs format) into milliseconds. Centiseconds may
 * be 1 or 2 digits ("01:15.5" === "01:15.50" === 75_500ms). Returns null for
 * malformed input, seconds > 59, or negatives. Minutes are unbounded.
 */
export function parseTimecode(str: string): number | null {
  const m = /^(\d+):([0-5]?\d)\.(\d{1,2})$/.exec(str.trim());
  if (!m) return null;
  const minutes = Number(m[1]);
  const seconds = Number(m[2]);
  const cs = Number(m[3]!.padEnd(2, "0")); // "5" → tenths → "50"
  return (minutes * 60 + seconds) * 1000 + cs * 10;
}
