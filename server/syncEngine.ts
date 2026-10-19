import type { AppSettings, ServerStatistics, Suggestion } from '../shared.js';
import { genreKey } from '../genres.js';
import { getDownloadAvailability, getSeerrMediaDetails, getSeerrRequests, getTautulliHistoryWithMetadata, seasonDownloadKey } from './apiClients.js';

function normalize(value: unknown): string {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}

function percent(item: any): number {
  if (!item) return 0;
  if (Number(item.watched_status) === 1) return 100;
  const direct = Number(item.percent_complete ?? item.progress_percent ?? 0);
  if (direct) return direct;
  const duration = Number(item.duration ?? item.play_duration ?? 0);
  const watched = Number(item.watched ?? item.view_offset ?? 0);
  return duration > 0 ? Math.min(100, (watched / duration) * 100) : Number(item.watched_status) === 1 ? 100 : 0;
}

function titleMatches(item: any, title: string, year?: number): boolean {
  const historyTitle = normalize(item.grandparent_title || item.title || item.full_title);
  const wanted = normalize(title);
  // Exact only: a partial match lets "You" count episodes of "Young Sheldon".
  if (!historyTitle || historyTitle !== wanted) return false;
  return !year || !item.year || Math.abs(Number(item.year) - year) <= 1;
}

function episodeMatchesSeries(item: any, title: string, seasonNumber: number): boolean {
  return titleMatches(item, title) && Number(item.parent_media_index ?? item.parent_index) === seasonNumber;
}

function matchingHistory(
  history: any[],
  mediaType: 'movie' | 'episode',
  externalId: number,
  titles: string[],
  year?: number,
  seasonNumber?: number
): { items: any[]; method: 'external-id' | 'title-year' | 'none' } {
  const providerField = mediaType === 'movie' ? 'tmdbId' : 'tvdbId';
  const seasonCandidates = mediaType === 'episode'
    ? history.filter((item) => Number(item.parent_media_index ?? item.parent_index) === seasonNumber)
    : history;
  const exact = seasonCandidates.filter((item) => Number(item.tautulliExternalIds?.[providerField]) === externalId);
  if (exact.length) return { items: exact, method: 'external-id' };

  const fallback = seasonCandidates.filter((item) => {
    if (Number(item.tautulliExternalIds?.[providerField]) > 0) return false;
    return titles.some((title) => mediaType === 'movie' ? titleMatches(item, title, year) : episodeMatchesSeries(item, title, seasonNumber ?? 0));
  });
  return fallback.length ? { items: fallback, method: 'title-year' } : { items: [], method: 'none' };
}

function requesterName(request: any): string {
  return request.requestedBy?.plexUsername || request.requestedBy?.displayName || request.requestedBy?.username || request.requestedBy?.email || 'Onbekende gebruiker';
}

interface RequestGroup {
  request: any;
  requestIds: number[];
}

function deduplicateSeerrRequests(requests: any[]): RequestGroup[] {
  const groups = new Map<string, RequestGroup>();
  for (const request of requests) {
    const requestId = Number(request.id);
    const mediaType = String(request.type || request.media?.mediaType || 'unknown');
    const tmdbId = Number(request.media?.tmdbId);
    const requester = normalize(requesterName(request));
    const seasons = [...new Set<number>((request.seasons ?? [])
      .map((season: any) => Number(season.seasonNumber))
      .filter((seasonNumber: number) => seasonNumber > 0))].sort((a, b) => a - b);
    const key = requestId > 0 && tmdbId > 0
      ? `${mediaType}:${tmdbId}:${requester}:${seasons.join(',')}`
      : `request:${requestId}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { request, requestIds: requestId > 0 ? [requestId] : [] });
      continue;
    }
    if (requestId > 0 && !existing.requestIds.includes(requestId)) existing.requestIds.push(requestId);
    const existingDate = new Date(String(existing.request.createdAt ?? '')).valueOf();
    const candidateDate = new Date(String(request.createdAt ?? '')).valueOf();
    if (Number.isFinite(candidateDate) && (!Number.isFinite(existingDate) || candidateDate < existingDate)) existing.request = request;
  }
  return [...groups.values()];
}

function originalTitle(details: any): string {
  return String(details.originalTitle || details.originalName || details.title || details.name || '').trim();
}

function posterUrl(details: any): string | undefined {
  const path = String(details.posterPath ?? '').trim();
  return path.startsWith('/') ? `https://image.tmdb.org/t/p/w185${path}` : undefined;
}

function genreNames(details: any): string[] {
  return [...new Set<string>((Array.isArray(details.genres) ? details.genres : [])
    .map((genre: any) => String(genre?.name ?? genre ?? '').trim())
    .filter(Boolean))];
}

function genreIds(details: any): number[] {
  return (Array.isArray(details.genres) ? details.genres : [])
    .map((genre: any) => Number(genre?.id))
    .filter((id: number) => Number.isInteger(id) && id > 0);
}

// Tautulli sends Unix seconds; milliseconds are accepted too.
function historyDateMs(value: unknown): number | undefined {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return raw > 1_000_000_000_000 ? raw : raw * 1000;
}

function historyDate(value: unknown): string | undefined {
  const ms = historyDateMs(value);
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

function toDate(value: unknown): string {
  const date = value ? new Date(typeof value === 'number' ? value : String(value)) : new Date();
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
}

function seasonCount(details: any, seasonNumber: number): number {
  return Number(details.seasons?.find((season: any) => Number(season.seasonNumber) === seasonNumber)?.episodeCount ?? 0);
}

function dateHasArrived(value: unknown, now = new Date()): boolean | undefined {
  if (!value) return undefined;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return undefined;
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  return date <= today;
}

function movieIsReleased(details: any, now = new Date()): boolean {
  const dateResult = dateHasArrived(details.releaseDate, now);
  if (dateResult !== undefined) return dateResult;
  const status = normalize(details.status);
  if (['rumored', 'planned', 'in production', 'post production'].includes(status)) return false;
  return true;
}

function seasonIsReleased(details: any, seasonNumber: number, now = new Date()): boolean {
  const season = details.seasons?.find((item: any) => Number(item.seasonNumber) === seasonNumber);
  const seasonDateResult = dateHasArrived(season?.airDate, now);
  if (seasonDateResult !== undefined) return seasonDateResult;

  const lastAiredSeason = Number(details.lastEpisodeToAir?.seasonNumber);
  if (lastAiredSeason) return seasonNumber <= lastAiredSeason;

  const firstAirDateResult = dateHasArrived(details.firstAirDate, now);
  if (firstAirDateResult === false) return false;
  return true;
}

function retentionStart(requestedAt: unknown, mediaAddedAt: unknown): string {
  const dates = [requestedAt, mediaAddedAt]
    .map((value) => new Date(String(value)))
    .filter((date) => !Number.isNaN(date.valueOf()));
  return new Date(Math.max(...dates.map((date) => date.valueOf()))).toISOString();
}

export function retentionExpired(startedAt: string, months: number, now = new Date(), days = 0): boolean {
  const start = new Date(startedAt);
  if (Number.isNaN(start.valueOf())) return false;
  const expiresAt = new Date(start);
  const dayOfMonth = expiresAt.getUTCDate();
  expiresAt.setUTCDate(1);
  expiresAt.setUTCMonth(expiresAt.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth() + 1, 0)).getUTCDate();
  expiresAt.setUTCDate(Math.min(dayOfMonth, lastDay) + days);
  return expiresAt < now;
}

function retentionReason(months: number, days: number): string {
  const parts = [];
  if (months) parts.push(`${months} ${months === 1 ? 'maand' : 'maanden'}`);
  if (days) parts.push(`${days} ${days === 1 ? 'dag' : 'dagen'}`);
  return `Langer dan ${parts.join(' en ') || '0 dagen'} beschikbaar`;
}

function watchedAfterRequestAt(items: any[], requestedAt: string, threshold: number): string | undefined {
  const requestedAtMs = new Date(requestedAt).valueOf();
  if (Number.isNaN(requestedAtMs)) return undefined;
  const watchedAt = items.map((item) => {
    const watchedAtMs = historyDateMs(item.date);
    return watchedAtMs !== undefined && watchedAtMs >= requestedAtMs && percent(item) >= threshold ? watchedAtMs : undefined;
  }).filter((value): value is number => value !== undefined);
  return watchedAt.length ? new Date(Math.max(...watchedAt)).toISOString() : undefined;
}

export interface ScanResult {
  suggestions: Suggestion[];
  serverStatistics: ServerStatistics;
  warnings: ScanWarning[];
}

export interface ScanWarning {
  requestIds: number[];
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  message: string;
}

export async function scanRequests(settings: AppSettings): Promise<ScanResult> {
  const [requests, downloadAvailability] = await Promise.all([
    getSeerrRequests(settings.services.seerr),
    getDownloadAvailability(settings)
  ]);
  const suggestions: Suggestion[] = [];
  const warnings: ScanWarning[] = [];
  const ignoredGenres = new Set(settings.ignoredGenres.map((genre) => genreKey(genre)));
  const historyCache = new Map<string, Promise<any[]>>();
  const historyFor = (requester: string, mediaType: 'movie' | 'episode') => {
    const key = `${requester.toLocaleLowerCase('nl-NL')}:${mediaType}`;
    const cached = historyCache.get(key);
    if (cached) return cached;
    const history = getTautulliHistoryWithMetadata(settings.services.tautulli, requester, mediaType);
    historyCache.set(key, history);
    return history;
  };

  for (const { request, requestIds } of deduplicateSeerrRequests(requests)) {
    const mediaType = request.type || request.media?.mediaType;
    const tmdbId = Number(request.media?.tmdbId);
    if (!tmdbId || !['movie', 'tv'].includes(mediaType)) continue;
    if (mediaType === 'movie' && !downloadAvailability.movieTmdbIds.has(tmdbId)) continue;

    let details: any;
    try {
      details = await getSeerrMediaDetails(settings.services.seerr, mediaType, tmdbId, settings.language);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Onbekende fout bij Seerr-mediagegevens';
      warnings.push({ requestIds, mediaType, tmdbId, message });
      console.warn(`Seerr-item overgeslagen (verzoek ${requestIds.join(', ') || 'onbekend'}, TMDB ${tmdbId}): ${message}`);
      continue;
    }
    const genres = genreNames(details);
    const genreIdsForMedia = genreIds(details);
    if (genres.some((genre, index) => ignoredGenres.has(genreKey(genre, genreIdsForMedia[index])))) continue;
    const localizedTitle = details.title || details.name || `TMDB ${tmdbId}`;
    const title = originalTitle(details) || localizedTitle;
    const titleAliases = [...new Set([title, localizedTitle])];
    const cover = posterUrl(details);
    const year = Number(String(details.releaseDate || details.firstAirDate || '').slice(0, 4)) || undefined;
    const requester = requesterName(request);
    const requestedAt = toDate(request.createdAt);
    const availableSince = retentionStart(request.createdAt, request.media?.mediaAddedAt);
    const isRetentionExpired = retentionExpired(availableSince, settings.retentionMonths, new Date(), settings.retentionDays);

    if (mediaType === 'movie') {
      if (!movieIsReleased(details)) continue;
      const history = await historyFor(requester, 'movie');
      const matched = matchingHistory(history, 'movie', tmdbId, titleAliases, year);
      const matches = matched.items;
      const best = matches.sort((a, b) => percent(b) - percent(a))[0];
      const progress = Math.round(percent(best));
      const watchedReady = progress >= settings.watchThreshold;
      const completedAfterRequestAt = watchedAfterRequestAt(matches, requestedAt, settings.watchThreshold);
      suggestions.push({
        id: `request-${request.id}-movie`, requestId: Number(request.id), requestIds, mediaKind: 'movie', title, posterUrl: cover, subtitle: 'Film', year,
        requester, requestedAt, availableSince, lastWatchedAt: historyDate(best?.date), watchedAfterRequestAt: completedAfterRequestAt,
        progress, watchedItems: watchedReady ? 1 : 0, totalItems: 1,
        status: watchedReady ? 'ready' : progress > 0 ? 'partial' : 'waiting',
        reason: watchedReady ? `${progress}% bekeken door aanvrager` : isRetentionExpired ? retentionReason(settings.retentionMonths, settings.retentionDays) : progress > 0 ? `${progress}% bekeken` : 'Nog niet bekeken',
        matchConfidence: matched.method === 'external-id' ? 'high' : matched.method === 'title-year' ? 'medium' : 'low', matchMethod: matched.method,
        suggestionBasis: watchedReady ? 'watched' : isRetentionExpired ? 'retention' : undefined, tmdbId, genres, genreIds: genreIdsForMedia,
        fileSizeBytes: downloadAvailability.movieFileSizes.get(tmdbId)
      });
      continue;
    }

    const seasons = request.seasons?.length ? request.seasons : (details.seasons ?? []).filter((season: any) => Number(season.seasonNumber) > 0);
    const requestedSeasonNumbers = [...new Set<number>(seasons.map((season: any) => Number(season.seasonNumber)).filter((seasonNumber: number) => seasonNumber > 0))];
    const tvdbId = Number(details.externalIds?.tvdbId);
    if (!tvdbId) continue;
    const history = await historyFor(requester, 'episode');
    for (const requestedSeason of seasons) {
      const seasonNumber = Number(requestedSeason.seasonNumber);
      if (!seasonNumber) continue;
      if (!downloadAvailability.seasonKeys.has(seasonDownloadKey(tvdbId, seasonNumber))) continue;
      if (!seasonIsReleased(details, seasonNumber)) continue;
      const totalItems = seasonCount(details, seasonNumber);
      const matched = matchingHistory(history, 'episode', tvdbId, titleAliases, year, seasonNumber);
      const matches = matched.items;
      const watchedEpisodes = new Map<number, any>();
      const watchedAfterRequestEpisodes = new Map<number, string>();
      for (const item of matches) {
        const episodeNumber = Number(item.media_index ?? item.index);
        if (!episodeNumber || percent(item) < settings.watchThreshold) continue;
        const current = watchedEpisodes.get(episodeNumber);
        if (!current || Number(item.date) > Number(current.date)) watchedEpisodes.set(episodeNumber, item);
        const completedAt = watchedAfterRequestAt([item], requestedAt, settings.watchThreshold);
        const currentAfterRequest = watchedAfterRequestEpisodes.get(episodeNumber);
        if (completedAt && (!currentAfterRequest || completedAt > currentAfterRequest)) watchedAfterRequestEpisodes.set(episodeNumber, completedAt);
      }
      const watchedItems = watchedEpisodes.size;
      const progress = totalItems ? Math.min(100, Math.round((watchedItems / totalItems) * 100)) : 0;
      const last = [...watchedEpisodes.values()].sort((a, b) => Number(b.date) - Number(a.date))[0];
      const watchedReady = totalItems > 0 && watchedItems >= totalItems;
      const completedAfterRequestAt = totalItems > 0 && watchedAfterRequestEpisodes.size >= totalItems
        ? [...watchedAfterRequestEpisodes.values()].sort().at(-1)
        : undefined;
      suggestions.push({
        id: `request-${request.id}-season-${seasonNumber}`, requestId: Number(request.id), requestIds, mediaKind: 'season', title, posterUrl: cover,
        subtitle: `Seizoen ${seasonNumber}`, year, requester, requestedAt, availableSince,
        lastWatchedAt: historyDate(last?.date),
        watchedAfterRequestAt: completedAfterRequestAt,
        progress, watchedItems, totalItems, status: watchedReady ? 'ready' : watchedItems ? 'partial' : 'waiting',
        reason: watchedReady ? `${watchedItems} van ${totalItems} afleveringen bekeken` : isRetentionExpired ? retentionReason(settings.retentionMonths, settings.retentionDays) : totalItems ? `${watchedItems} van ${totalItems} afleveringen bekeken` : 'Aantal afleveringen onbekend',
        matchConfidence: matched.method === 'external-id' ? 'high' : matched.method === 'title-year' ? 'medium' : 'low', matchMethod: matched.method,
        suggestionBasis: watchedReady ? 'watched' : isRetentionExpired ? 'retention' : undefined,
        tmdbId, tvdbId, seasonNumber, requestedSeasonNumbers, genres, genreIds: genreIdsForMedia,
        fileSizeBytes: downloadAvailability.seasonFileSizes.get(seasonDownloadKey(tvdbId, seasonNumber))
      });
    }
  }
  return { suggestions, serverStatistics: downloadAvailability.serverStatistics, warnings };
}

export const testing = {
  normalize,
  percent,
  titleMatches,
  episodeMatchesSeries,
  matchingHistory,
  originalTitle,
  posterUrl,
  genreNames,
  genreIds,
  toDate,
  historyDate,
  movieIsReleased,
  seasonIsReleased,
  retentionStart,
  retentionExpired,
  watchedAfterRequestAt,
  deduplicateSeerrRequests
};
