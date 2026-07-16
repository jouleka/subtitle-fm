import type { Episode, EpisodeStatus, Show } from './types';

export interface CatalogShow extends Show {
  episodes: Episode[];
}

const STATUS_LABELS: Record<EpisodeStatus, string> = {
  uploaded: 'Queued',
  preprocessing: 'Preparing',
  transcribing: 'Transcribing',
  translating: 'Translating',
  ready_for_edit: 'Ready to edit',
  in_review: 'In review',
  publishing: 'Publishing',
  published: 'Published',
  removed: 'Unavailable',
  failed: 'Needs attention',
};

export function buildCatalog(shows: Show[], episodes: Episode[]): CatalogShow[] {
  const episodesByShow = new Map<string, Episode[]>();
  for (const episode of episodes) {
    const grouped = episodesByShow.get(episode.showId) ?? [];
    grouped.push(episode);
    episodesByShow.set(episode.showId, grouped);
  }

  return shows
    .map((show) => ({
      ...show,
      episodes: (episodesByShow.get(show.id) ?? []).sort(
        (left, right) =>
          left.number - right.number || left.createdAt.localeCompare(right.createdAt),
      ),
    }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

export function episodeName(episode: Episode): string {
  return episode.title?.trim() || `Episode ${episode.number}`;
}

export function statusLabel(status: EpisodeStatus): string {
  return STATUS_LABELS[status];
}
