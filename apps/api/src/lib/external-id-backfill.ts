import { z } from 'zod';

export const EXTERNAL_ID_FIELDS = ['imdbId', 'malId', 'kitsuId', 'anilistId'] as const;
export type ExternalIdField = (typeof EXTERNAL_ID_FIELDS)[number];

const numericExternalId = z.string().trim().regex(/^\d+$/).max(30);
const mappingSchema = z
  .object({
    showId: z.string().trim().min(1),
    imdbId: z
      .string()
      .trim()
      .regex(/^tt\d+$/)
      .max(30)
      .optional(),
    malId: numericExternalId.optional(),
    kitsuId: numericExternalId.optional(),
    anilistId: numericExternalId.optional(),
  })
  .strict()
  .refine((row) => EXTERNAL_ID_FIELDS.some((field) => row[field]), {
    message: 'at least one external id is required',
  });

export type ExternalIdMapping = z.infer<typeof mappingSchema>;
export type ExistingShowIds = { showId: string } & Record<ExternalIdField, string | null>;

export function parseExternalIdMappings(input: string): ExternalIdMapping[] {
  const rows = z.array(mappingSchema).min(1).parse(JSON.parse(input));
  const showIds = new Set<string>();
  const externalIds = new Map<string, string>();
  for (const row of rows) {
    if (showIds.has(row.showId)) throw new Error(`duplicate showId in mapping: ${row.showId}`);
    showIds.add(row.showId);
    for (const field of EXTERNAL_ID_FIELDS) {
      const value = row[field];
      if (!value) continue;
      const key = `${field}:${value}`;
      const owner = externalIds.get(key);
      if (owner) throw new Error(`duplicate ${field} ${value} for ${owner} and ${row.showId}`);
      externalIds.set(key, row.showId);
    }
  }
  return rows;
}

export type ExternalIdBackfillPlan = {
  showId: string;
  changes: Partial<Record<ExternalIdField, string>>;
  errors: string[];
};

export function planExternalIdBackfill(
  mappings: ExternalIdMapping[],
  existing: ExistingShowIds[],
): ExternalIdBackfillPlan[] {
  const byShow = new Map(existing.map((show) => [show.showId, show]));
  const owners = new Map<string, string>();
  for (const show of existing) {
    for (const field of EXTERNAL_ID_FIELDS) {
      if (show[field]) owners.set(`${field}:${show[field]}`, show.showId);
    }
  }

  return mappings.map((mapping) => {
    const current = byShow.get(mapping.showId);
    const plan: ExternalIdBackfillPlan = { showId: mapping.showId, changes: {}, errors: [] };
    if (!current) {
      plan.errors.push('show_not_found');
      return plan;
    }
    for (const field of EXTERNAL_ID_FIELDS) {
      const wanted = mapping[field];
      if (!wanted) continue;
      const owner = owners.get(`${field}:${wanted}`);
      if (owner && owner !== mapping.showId) {
        plan.errors.push(`${field}_owned_by:${owner}`);
        continue;
      }
      if (current[field] && current[field] !== wanted) {
        plan.errors.push(`${field}_conflict:${current[field]}`);
        continue;
      }
      if (!current[field]) plan.changes[field] = wanted;
    }
    return plan;
  });
}
