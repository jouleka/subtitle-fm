import { z } from 'zod';

export const CueStyle = z.object({
  name: z.string(),
  fontName: z.string().optional(),
  fontSize: z.number().optional(),
  primaryColor: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
});
export type CueStyle = z.infer<typeof CueStyle>;

export const Cue = z.object({
  id: z.string(),
  episodeId: z.string().uuid(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  styleName: z.string().default('Default'),
  speakerId: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  needsReview: z.boolean().default(false),
});
export type Cue = z.infer<typeof Cue>;
