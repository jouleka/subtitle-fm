// Shared types between the web app and the api's JSON responses.
// Kept here (not in @subtitle-fm/shared) because they're web-specific shapes:
// what the api returns after Drizzle serialization, not the DB row exactly.

export type EpisodeStatus =
  | "uploaded"
  | "preprocessing"
  | "transcribing"
  | "translating"
  | "ready_for_edit"
  | "in_review"
  | "published"
  | "failed";

export interface Episode {
  id: string;
  showId: string;
  number: number;
  title: string | null;
  sourceLanguage: string;
  targetLanguage: string;
  status: EpisodeStatus;
  audioUrl: string | null;
  peaksUrl: string | null;
  durationMs: number | null;
  createdAt: string; // ISO timestamp
  updatedAt: string;
}

export interface Cue {
  id: string;
  episodeId: string;
  orderIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  rawOverrideTags: string;
  styleName: string;
  speakerId: string | null;
  confidence: number | null;
  needsReview: boolean;
  lastEditedBy: string | null;
  updatedAt: string;
}
