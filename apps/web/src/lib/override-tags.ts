export type Segment = { kind: "text" | "tag"; value: string };

// Matches any closed brace group — no backslash required. This is display-only,
// not a semantic ASS parser, so every closed `{...}` group is treated as opaque.
const TAG_RE = /\{[^}]*\}/g;

/**
 * Split cue text into alternating text/tag segments for display highlighting.
 * A "tag" segment is a well-formed brace group `{...}`; everything else is
 * "text". Total and deterministic.
 *
 * Contract (the property the highlight backdrop relies on):
 *   segmentOverrideTags(s).map(seg => seg.value).join("") === s   for all s
 *
 * An unclosed `{` with no closing `}` does NOT match and stays in a text
 * segment — we only mark well-formed groups, never eat the rest of the line.
 * Empty text segments between adjacent tags are not emitted.
 */
export function segmentOverrideTags(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TAG_RE)) {
    const start = m.index; // non-optional for matchAll's RegExpExecArray results
    if (start > last) out.push({ kind: "text", value: text.slice(last, start) });
    out.push({ kind: "tag", value: m[0] });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
  return out;
}
