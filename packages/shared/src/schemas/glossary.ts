import { z } from 'zod';

export const GlossaryTermKind = z.enum(['name', 'place', 'term', 'attack', 'honorific']);
export type GlossaryTermKind = z.infer<typeof GlossaryTermKind>;

export const GlossaryTerm = z.object({
  id: z.string().uuid(),
  showId: z.string(),
  sourceText: z.string(),
  targetText: z.string(),
  kind: GlossaryTermKind,
  notes: z.string().nullable(),
});
export type GlossaryTerm = z.infer<typeof GlossaryTerm>;
