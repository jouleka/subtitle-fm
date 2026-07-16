import { z } from 'zod';

export const EpisodeStatus = z.enum([
  'uploaded',
  'preprocessing',
  'transcribing',
  'translating',
  'ready_for_edit',
  'in_review',
  'publishing',
  'published',
  'failed',
]);
export type EpisodeStatus = z.infer<typeof EpisodeStatus>;

export const Episode = z.object({
  id: z.string().uuid(),
  showId: z.string(),
  number: z.number().int().nonnegative(),
  title: z.string().nullable(),
  sourceLanguage: z.string().default('ja'),
  targetLanguage: z.string().default('en'),
  status: EpisodeStatus,
  sourceKey: z.string().nullable(),
  audioUrl: z.string().url().nullable(),
  peaksUrl: z.string().url().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Episode = z.infer<typeof Episode>;
