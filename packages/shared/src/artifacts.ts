/** Canonical published subtitle keys shared by the API and publish worker. */
export function publishedSubtitleKeys(episodeId: string) {
  assertEpisodeId(episodeId);
  const base = `subtitles/${episodeId}/published`;
  return { ass: `${base}.ass`, srt: `${base}.srt`, vtt: `${base}.vtt` } as const;
}

/** Intermediate pipeline objects that are no longer needed after publishing. */
export function temporaryMediaObjects(episodeId: string, sourceKey?: string | null) {
  assertEpisodeId(episodeId);
  const objects: Array<{ bucket: 'media'; key: string }> = [
    { bucket: 'media' as const, key: `stage/preprocess/${episodeId}.wav` },
    { bucket: 'media' as const, key: `stage/transcribe/${episodeId}.json` },
  ];
  if (sourceKey) {
    if (!/^uploads\/[0-9a-f-]{36}\.[a-z0-9]+$/i.test(sourceKey) || sourceKey.includes('..')) {
      throw new Error(`invalid source media key: ${sourceKey}`);
    }
    objects.push({ bucket: 'media', key: sourceKey });
  }
  return objects;
}

function assertEpisodeId(episodeId: string): void {
  if (!episodeId || episodeId.includes('/') || episodeId.includes('..')) {
    throw new Error(`invalid episode id: ${episodeId}`);
  }
}
