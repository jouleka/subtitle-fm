import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export { schema };

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb(connectionString?: string) {
  if (_db) return _db;
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const client = postgres(url, { max: 10 });
  _db = drizzle(client, { schema });
  return _db;
}

export type Db = ReturnType<typeof getDb>;

export { advanceEpisodeStatus, failEpisode, type AdvanceResult } from './episodes';
