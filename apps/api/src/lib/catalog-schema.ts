import { z } from 'zod';

/**
 * Catalog manifest schema + parser. Deliberately side-effect-free (imports only
 * zod) so the CLI's `--dry-run` can validate a manifest without importing the
 * DB/queue layer (which opens Redis at module load). The DB-touching ingest core
 * lives in ./ingest and is only imported on the real-run path.
 *
 * Shape: an array of shows, each carrying its episodes (catalog = show-centric,
 * unlike the smoke-test's flat episode array).
 */

// Optional external ids are UNIQUE-indexed on `shows`. Reject empty strings:
// "" is not NULL, so two shows with malId:"" would collide on the unique index.
const externalId = z.string().min(1).optional();

const catalogEpisodeSchema = z.object({
  seasonNumber: z.number().int().nonnegative().default(1),
  number: z.number().int().nonnegative(),
  sourceUrl: z.string().url(),
  title: z.string().optional(),
  sourceLanguage: z.string().default('ja'),
  targetLanguage: z.string().default('en'),
});

export const catalogShowSchema = z
  .object({
    id: z.string().min(1).max(64),
    title: z.string().min(1),
    slug: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits, and hyphens only'),
    description: z.string().optional(),
    malId: externalId,
    anilistId: externalId,
    kitsuId: externalId,
    coverUrl: z.string().url().optional(),
    episodes: z.array(catalogEpisodeSchema).min(1),
  })
  .superRefine((show, ctx) => {
    // A duplicate season+episode with a different sourceUrl would be silently
    // dropped by the DB constraint, so reject it before starting an import.
    const seen = new Set<string>();
    for (const e of show.episodes) {
      const identity = `${e.seasonNumber}:${e.number}`;
      if (seen.has(identity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate season ${e.seasonNumber} episode ${e.number} in show "${show.id}"`,
          path: ['episodes'],
        });
      }
      seen.add(identity);
    }
  });

const catalogManifestSchema = z
  .array(catalogShowSchema)
  .min(1)
  .superRefine((shows, ctx) => {
    const seen = new Set<string>();
    for (const s of shows) {
      if (seen.has(s.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate show id "${s.id}" in manifest`,
          path: [],
        });
      }
      seen.add(s.id);
    }
  });

export type CatalogEpisode = z.infer<typeof catalogEpisodeSchema>;
export type CatalogShow = z.infer<typeof catalogShowSchema>;

/**
 * Parse + validate a catalog manifest from raw JSON text. Throws a single Error
 * with all validation issues joined, so a CLI can print one clear message.
 */
export function parseCatalog(text: string): CatalogShow[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`manifest is not valid JSON: ${(e as Error).message}`);
  }
  const result = catalogManifestSchema.safeParse(json);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`invalid manifest: ${detail}`);
  }
  return result.data;
}
