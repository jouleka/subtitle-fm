/**
 * Thin re-export so handler files keep importing from a local path. The
 * actual implementation lives in @subtitle-fm/db so the api and the
 * worker-runner share one transition function and can't drift.
 */
export { advanceEpisodeStatus, failEpisode, type AdvanceResult } from '@subtitle-fm/db';
