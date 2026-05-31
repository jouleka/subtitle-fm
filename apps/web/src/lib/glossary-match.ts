import type { GlossaryTerm } from '@subtitle-fm/shared';

// A term "matches" the focused cue when its source OR target string occurs
// (case-insensitive substring) in the cue text. Either-side because cues may
// hold the source headword (romaji/CJK) or the canonical target rendering.
// Returns a Set for O(1) lookup in the panel render.
export function matchingTermIds(cueText: string, terms: GlossaryTerm[]): Set<string> {
  const ids = new Set<string>();
  const hay = cueText.toLowerCase();
  if (!hay) return ids;
  for (const t of terms) {
    const src = t.sourceText.toLowerCase();
    const tgt = t.targetText.toLowerCase();
    if ((src && hay.includes(src)) || (tgt && hay.includes(tgt))) ids.add(t.id);
  }
  return ids;
}
