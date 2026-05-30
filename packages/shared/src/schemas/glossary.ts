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

export const CreateGlossaryTerm = z.object({
  sourceText: z.string().min(1),
  targetText: z.string().min(1),
  kind: GlossaryTermKind,
  notes: z.string().nullable().optional(),
});
export type CreateGlossaryTerm = z.infer<typeof CreateGlossaryTerm>;

export const UpdateGlossaryTerm = z
  .object({
    targetText: z.string().min(1).optional(),
    kind: GlossaryTermKind.optional(),
    notes: z.string().nullable().optional(),
  })
  // Bodies come from JSON.parse (no `undefined` values), so Object.keys reliably
  // counts only present keys; an empty {} is rejected → 400 (never a Drizzle .set({})).
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field required" });
export type UpdateGlossaryTerm = z.infer<typeof UpdateGlossaryTerm>;
