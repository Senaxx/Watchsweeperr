export type ServiceName = 'seerr' | 'tautulli' | 'radarr' | 'sonarr';
export type Language = 'nl' | 'en';
export type MediaKind = 'movie' | 'season';
export type SuggestionStatus = 'ready' | 'partial' | 'waiting' | 'removed' | 'dismissed';

export interface ServiceConfig {
  url: string;
  apiKey: string;
}

export interface AutomaticRemovalRule {
  requester: string;
  movies: boolean;
  series: boolean;
  delayDays: number;
}

export interface AppSettings {
  language: Language;
  demoMode: boolean;
  watchThreshold: number;
  retentionMonths: number;
  retentionDays: number;
  excludedUsers: string[];
  ignoredGenres: string[];
  automaticRemovalRules: AutomaticRemovalRule[];
  services: Record<ServiceName, ServiceConfig>;
}

export interface PublicServiceConfig {
  url: string;
  configured: boolean;
  keyPreview: string;
}

export interface PublicSettings {
  language: Language;
  demoMode: boolean;
  watchThreshold: number;
  retentionMonths: number;
  retentionDays: number;
  excludedUsers: string[];
  ignoredGenres: string[];
  automaticRemovalRules: AutomaticRemovalRule[];
  services: Record<ServiceName, PublicServiceConfig>;
}

export interface Suggestion {
  id: string;
  requestId: number;
  requestIds?: number[];
  mediaKind: MediaKind;
  title: string;
  posterUrl?: string;
  subtitle: string;
  year?: number;
  requester: string;
  requestedAt: string;
  availableSince?: string;
  lastWatchedAt?: string;
  watchedAfterRequestAt?: string;
  progress: number;
  watchedItems: number;
  totalItems: number;
  status: SuggestionStatus;
  reason: string;
  statusBeforeDismiss?: 'ready' | 'partial' | 'waiting';
  reasonBeforeDismiss?: string;
  matchConfidence: 'high' | 'medium' | 'low';
  matchMethod?: 'external-id' | 'title-year' | 'none';
  suggestionBasis?: 'watched' | 'retention';
  tmdbId?: number;
  tvdbId?: number;
  seasonNumber?: number;
  requestedSeasonNumbers?: number[];
  genres?: string[];
  genreIds?: number[];
  fileSizeBytes?: number;
}

export interface ActivityItem {
  id: string;
  type: 'sync' | 'remove' | 'dismiss' | 'settings';
  title: string;
  detail: string;
  createdAt: string;
  outcome: 'success' | 'info' | 'error';
}

export interface ServerStatistics {
  movies: number;
  episodes: number;
  freeSpaceBytes?: number;
  updatedAt: string;
}

export interface AppState {
  suggestions: Suggestion[];
  ignoredSuggestionIds: string[];
  activity: ActivityItem[];
  lastSyncAt?: string;
  serverStatistics?: ServerStatistics;
}

export interface HiddenCounts {
  excludedUsers: number;
  ignoredGenres: number;
  notYetDue: number;
}

export interface Overview extends AppState {
  demoMode: boolean;
  hidden: HiddenCounts;
  servicesConfigured: number;
  ignoredSuggestions: Suggestion[];
}
