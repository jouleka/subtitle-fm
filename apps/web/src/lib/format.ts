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
