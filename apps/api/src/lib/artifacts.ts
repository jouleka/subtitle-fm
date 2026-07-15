/** Canonical waveform artifact key shared by callback validation and serving. */
export function episodePeaksKey(episodeId: string): string {
  if (!episodeId || episodeId.includes('/') || episodeId.includes('..')) {
    throw new Error(`invalid episode id: ${episodeId}`);
  }
  return `${episodeId}.dat`;
}

/** Stable application URL persisted in the episode row. */
export function episodePeaksUrl(apiBase: string, episodeId: string): string {
  return `${apiBase.replace(/\/+$/, '')}/episodes/${episodeId}/peaks.dat`;
}
