import type { AppSettings, ServerStatistics, ServiceConfig, ServiceName, Suggestion } from '../shared.js';

const TIMEOUT_MS = 12_000;

interface RequestContext {
  service: 'Seerr' | 'Tautulli' | 'Radarr' | 'Sonarr';
  action: string;
}

export class ServiceApiError extends Error {
  constructor(
    public readonly service: RequestContext['service'],
    public readonly action: string,
    public readonly upstreamStatus?: number,
    detail?: string
  ) {
    const status = upstreamStatus ? ` (${upstreamStatus})` : '';
    const hint = upstreamStatus === 401
      ? ' Controleer de API-key.'
      : upstreamStatus === 403
        ? ' Controleer of de API-key toegang tot deze functie heeft.'
        : upstreamStatus === 404
          ? ' Controleer de basis-URL.'
          : '';
    super(`${service}: ${action} mislukt${status}.${hint}${detail ? ` Antwoord: ${detail}` : ''}`);
    this.name = 'ServiceApiError';
  }
}

async function jsonRequest<T>(url: string, init: RequestInit = {}, context?: RequestContext): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (context) throw new ServiceApiError(context.service, context.action, undefined, error instanceof Error ? error.message : 'Netwerkfout');
    throw error;
  }
  const text = await response.text();
  if (!response.ok) {
    if (context) throw new ServiceApiError(context.service, context.action, response.status, text.slice(0, 220));
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 220)}` : ''}`);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

function apiUrl(service: ServiceConfig, pathname: string, query: Record<string, string | number> = {}): string {
  const url = new URL(`${service.url.replace(/\/$/, '')}${pathname}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return url.toString();
}

function jsonHeaders(service: ServiceConfig): HeadersInit {
  return { 'X-Api-Key': service.apiKey, 'Content-Type': 'application/json' };
}

function tautulliHeaders(service: ServiceConfig): HeadersInit {
  return { 'X-Api-Key': service.apiKey };
}

export interface DownloadAvailability {
  movieTmdbIds: Set<number>;
  seasonKeys: Set<string>;
  movieFileSizes: Map<number, number>;
  seasonFileSizes: Map<string, number>;
  serverStatistics: ServerStatistics;
}

export function seasonDownloadKey(tvdbId: number, seasonNumber: number): string {
  return `${tvdbId}:${seasonNumber}`;
}

export async function testService(name: ServiceName, service: ServiceConfig): Promise<string> {
  if (!service.url || !service.apiKey) throw new Error('URL en API-key zijn verplicht.');
  if (name === 'tautulli') {
    const result = await jsonRequest<any>(apiUrl(service, '/api/v2', { cmd: 'get_tautulli_info' }), { headers: tautulliHeaders(service) }, { service: 'Tautulli', action: 'verbinding testen' });
    if (result?.response?.result !== 'success') throw new Error(result?.response?.message || 'Tautulli gaf geen succesvol antwoord.');
    return result.response.data?.tautulli_version || 'verbonden';
  }
  if (name === 'seerr') {
    const result = await jsonRequest<any>(apiUrl(service, '/api/v1/status'), { headers: jsonHeaders(service) }, { service: 'Seerr', action: 'status lezen' });
    await jsonRequest<any>(apiUrl(service, '/api/v1/request', { take: 1, skip: 0, sort: 'added', filter: 'all' }), { headers: jsonHeaders(service) }, { service: 'Seerr', action: 'verzoeken lezen' });
    return result?.version || 'verbonden';
  }
  const label = name === 'radarr' ? 'Radarr' : 'Sonarr';
  const result = await jsonRequest<any>(apiUrl(service, '/api/v3/system/status'), { headers: jsonHeaders(service) }, { service: label, action: 'verbinding testen' });
  return result?.version || 'verbonden';
}

export async function getSeerrRequests(service: ServiceConfig): Promise<any[]> {
  const all: any[] = [];
  let skip = 0;
  const take = 100;
  do {
    const page = await jsonRequest<any>(apiUrl(service, '/api/v1/request', { take, skip, sort: 'added', filter: 'all' }), { headers: jsonHeaders(service) }, { service: 'Seerr', action: 'verzoeken lezen' });
    const results = Array.isArray(page?.results) ? page.results : [];
    all.push(...results);
    skip += results.length;
    if (results.length < take || skip >= Number(page?.pageInfo?.results ?? all.length)) break;
  } while (skip < 10_000);
  return all;
}

export async function getSeerrMediaDetails(service: ServiceConfig, mediaType: string, tmdbId: number, language?: AppSettings['language']): Promise<any> {
  const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
  return jsonRequest<any>(apiUrl(service, `/api/v1/${endpoint}/${tmdbId}`, language ? { language } : {}), { headers: jsonHeaders(service) }, { service: 'Seerr', action: 'mediagegevens lezen' });
}

export async function getTautulliHistory(service: ServiceConfig, user: string, mediaType: 'movie' | 'episode', search?: string): Promise<any[]> {
  const all: any[] = [];
  const length = 500;
  let start = 0;
  do {
    const query: Record<string, string | number> = { cmd: 'get_history', user, media_type: mediaType, grouping: 1, start, length };
    if (search) query.search = search;
    const result = await jsonRequest<any>(apiUrl(service, '/api/v2', query), { headers: tautulliHeaders(service) }, { service: 'Tautulli', action: 'kijkgeschiedenis lezen' });
    if (result?.response?.result !== 'success') throw new Error(result?.response?.message || 'Tautulli geschiedenis kon niet worden gelezen.');
    const items = Array.isArray(result.response.data?.data) ? result.response.data.data : [];
    all.push(...items);
    start += items.length;
    const total = Number(result.response.data?.recordsFiltered ?? all.length);
    if (!items.length || items.length < length || start >= total) break;
  } while (start < 10_000);
  return all;
}

const tautulliMetadataCache = new Map<string, Promise<any>>();

async function getTautulliMetadata(service: ServiceConfig, ratingKey: string): Promise<any> {
  const cacheKey = `${service.url}:${ratingKey}`;
  const cached = tautulliMetadataCache.get(cacheKey);
  if (cached) return cached;
  const request = jsonRequest<any>(apiUrl(service, '/api/v2', { cmd: 'get_metadata', rating_key: ratingKey }), { headers: tautulliHeaders(service) }, { service: 'Tautulli', action: 'Plex-metadata lezen' })
    .then((result) => {
      if (result?.response?.result !== 'success') throw new Error(result?.response?.message || 'Tautulli metadata kon niet worden gelezen.');
      return result.response.data ?? {};
    })
    .catch((error) => {
      tautulliMetadataCache.delete(cacheKey);
      throw error;
    });
  if (tautulliMetadataCache.size >= 2_000) tautulliMetadataCache.delete(tautulliMetadataCache.keys().next().value as string);
  tautulliMetadataCache.set(cacheKey, request);
  return request;
}

function idFromGuids(guids: unknown, provider: 'tmdb' | 'tvdb'): number | undefined {
  if (!Array.isArray(guids)) return undefined;
  const prefix = `${provider}://`;
  const value = guids.find((guid) => String(guid).toLowerCase().startsWith(prefix));
  const id = Number(String(value ?? '').slice(prefix.length).split(/[?/#]/)[0]);
  return id > 0 ? id : undefined;
}

async function mapConcurrent<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      result[index] = await mapper(items[index]);
    }
  }));
  return result;
}

export async function getTautulliHistoryWithMetadata(service: ServiceConfig, user: string, mediaType: 'movie' | 'episode'): Promise<any[]> {
  const history = await getTautulliHistory(service, user, mediaType);
  return mapConcurrent(history, 8, async (item) => {
    const ratingKey = String(item.rating_key ?? '').trim();
    if (!ratingKey) return item;
    try {
      const metadata = await getTautulliMetadata(service, ratingKey);
      const tmdbId = mediaType === 'movie' ? idFromGuids(metadata.guids, 'tmdb') : undefined;
      const tvdbId = mediaType === 'episode' ? idFromGuids(metadata.grandparent_guids, 'tvdb') : undefined;
      return { ...item, tautulliExternalIds: { ...(tmdbId ? { tmdbId } : {}), ...(tvdbId ? { tvdbId } : {}) } };
    } catch {
      return item;
    }
  });
}

export async function getDownloadAvailability(settings: AppSettings): Promise<DownloadAvailability> {
  const [movies, seriesList, radarrDisks, sonarrDisks] = await Promise.all([
    jsonRequest<any[]>(apiUrl(settings.services.radarr, '/api/v3/movie'), { headers: jsonHeaders(settings.services.radarr) }, { service: 'Radarr', action: 'films lezen' }),
    jsonRequest<any[]>(apiUrl(settings.services.sonarr, '/api/v3/series'), { headers: jsonHeaders(settings.services.sonarr) }, { service: 'Sonarr', action: 'series lezen' }),
    jsonRequest<any[]>(apiUrl(settings.services.radarr, '/api/v3/diskspace'), { headers: jsonHeaders(settings.services.radarr) }, { service: 'Radarr', action: 'opslagruimte lezen' }).catch(() => []),
    jsonRequest<any[]>(apiUrl(settings.services.sonarr, '/api/v3/diskspace'), { headers: jsonHeaders(settings.services.sonarr) }, { service: 'Sonarr', action: 'opslagruimte lezen' }).catch(() => [])
  ]);

  const downloadedMovies = movies.filter((movie) => movie.hasFile === true);
  const movieTmdbIds = new Set(downloadedMovies
    .map((movie) => Number(movie.tmdbId))
    .filter((tmdbId) => tmdbId > 0));
  const movieFileSizes = new Map<number, number>();
  for (const movie of downloadedMovies) {
    const tmdbId = Number(movie.tmdbId);
    const size = Number(movie.sizeOnDisk ?? movie.movieFile?.size ?? 0);
    if (tmdbId > 0 && Number.isFinite(size) && size >= 0) movieFileSizes.set(tmdbId, size);
  }

  const seasonKeys = new Set<string>();
  const seasonFileSizes = new Map<string, number>();
  for (const series of seriesList) {
    const tvdbId = Number(series.tvdbId);
    if (!tvdbId) continue;
    for (const season of series.seasons ?? []) {
      const seasonNumber = Number(season.seasonNumber);
      const fileCount = Number(season.statistics?.episodeFileCount ?? 0);
      if (seasonNumber > 0 && fileCount > 0) {
        const key = seasonDownloadKey(tvdbId, seasonNumber);
        seasonKeys.add(key);
        const size = Number(season.statistics?.sizeOnDisk ?? 0);
        if (Number.isFinite(size) && size >= 0) seasonFileSizes.set(key, size);
      }
    }
  }

  const episodes = seriesList.reduce((total, series) => {
    const seriesFileCount = Number(series.statistics?.episodeFileCount);
    const seasonFileCount = (series.seasons ?? []).reduce((sum: number, season: any) => sum + Math.max(0, Number(season.statistics?.episodeFileCount ?? 0)), 0);
    return total + (Number.isFinite(seriesFileCount) ? Math.max(0, seriesFileCount) : seasonFileCount);
  }, 0);
  const uniqueDisks = new Map<string, number>();
  for (const disk of [...radarrDisks, ...sonarrDisks]) {
    const freeSpace = Number(disk.freeSpace);
    const totalSpace = Number(disk.totalSpace);
    if (!Number.isFinite(freeSpace) || freeSpace < 0) continue;
    uniqueDisks.set(`${freeSpace}:${Number.isFinite(totalSpace) ? totalSpace : ''}`, freeSpace);
  }
  const freeSpaceBytes = uniqueDisks.size ? [...uniqueDisks.values()].reduce((sum, value) => sum + value, 0) : undefined;

  return {
    movieTmdbIds,
    seasonKeys,
    movieFileSizes,
    seasonFileSizes,
    serverStatistics: {
      movies: downloadedMovies.length,
      episodes,
      freeSpaceBytes,
      updatedAt: new Date().toISOString()
    }
  };
}

export async function deleteSeerrRequest(service: ServiceConfig, requestId: number): Promise<string> {
  const url = apiUrl(service, `/api/v1/request/${requestId}`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'DELETE',
      headers: jsonHeaders(service),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    throw new ServiceApiError('Seerr', 'verzoek verwijderen', undefined, error instanceof Error ? error.message : 'Netwerkfout');
  }
  if (response.status === 404) return 'Seerr-verzoek was al verwijderd.';
  if (!response.ok) {
    const text = await response.text();
    throw new ServiceApiError('Seerr', 'verzoek verwijderen', response.status, text.slice(0, 220));
  }
  return 'Seerr-verzoek verwijderd.';
}

export async function removeMedia(settings: AppSettings, suggestion: Suggestion): Promise<string> {
  if (suggestion.mediaKind === 'movie') {
    const movies = await jsonRequest<any[]>(apiUrl(settings.services.radarr, '/api/v3/movie', { tmdbId: Number(suggestion.tmdbId) }), { headers: jsonHeaders(settings.services.radarr) }, { service: 'Radarr', action: 'films lezen voor verwijdering' });
    const movie = movies.find((item) => Number(item.tmdbId) === suggestion.tmdbId);
    if (!movie) return 'Film was al verwijderd uit Radarr.';
    await jsonRequest<unknown>(apiUrl(settings.services.radarr, `/api/v3/movie/${movie.id}`, { deleteFiles: 'true', addImportExclusion: 'false' }), {
      method: 'DELETE', headers: jsonHeaders(settings.services.radarr)
    }, { service: 'Radarr', action: 'film en bestanden verwijderen' });
    return `Film, volledige map en Radarr-item verwijderd (id ${movie.id}).`;
  }

  return removeSeasonGroup(settings, [suggestion]);
}

export async function removeSeasonGroup(settings: AppSettings, suggestions: Suggestion[]): Promise<string> {
  const first = suggestions[0];
  const tvdbId = first?.tvdbId;
  const targetSeasons = [...new Set(suggestions.map((item) => Number(item.seasonNumber)).filter((seasonNumber) => seasonNumber > 0))];
  if (!first || !tvdbId || !targetSeasons.length || suggestions.some((item) => item.tvdbId !== tvdbId)) {
    throw new Error('Ongeldige of gemengde seizoenselectie.');
  }
  const seriesList = await jsonRequest<any[]>(apiUrl(settings.services.sonarr, '/api/v3/series', { tvdbId }), { headers: jsonHeaders(settings.services.sonarr) }, { service: 'Sonarr', action: 'series lezen voor verwijdering' });
  const series = seriesList.find((item) => Number(item.tvdbId) === tvdbId);
  if (!series) return 'Serie was al verwijderd uit Sonarr.';
  const downloadedSeasons = (series.seasons ?? [])
    .filter((season: any) => Number(season.seasonNumber) > 0 && Number(season.statistics?.episodeFileCount ?? 0) > 0)
    .map((season: any) => Number(season.seasonNumber));
  const removesAllDownloadedSeasons = downloadedSeasons.length > 0
    && downloadedSeasons.every((seasonNumber: number) => targetSeasons.includes(seasonNumber));

  if (removesAllDownloadedSeasons) {
    await jsonRequest<unknown>(apiUrl(settings.services.sonarr, `/api/v3/series/${series.id}`, {
      deleteFiles: 'true',
      addImportListExclusion: 'false'
    }), { method: 'DELETE', headers: jsonHeaders(settings.services.sonarr) }, { service: 'Sonarr', action: 'serie en bestanden verwijderen' });
    return `Alle resterende seizoenen, volledige seriemap en Sonarr-item verwijderd (id ${series.id}).`;
  }

  const episodeGroups = await Promise.all(targetSeasons.map((seasonNumber) => jsonRequest<any[]>(apiUrl(settings.services.sonarr, '/api/v3/episode', {
    seriesId: series.id,
    seasonNumber,
    includeImages: 'false'
  }), { headers: jsonHeaders(settings.services.sonarr) }, { service: 'Sonarr', action: `afleveringen van seizoen ${seasonNumber} lezen` })));
  const fileIds = [...new Set(episodeGroups.flat()
    .filter((episode) => targetSeasons.includes(Number(episode.seasonNumber)))
    .map((episode) => Number(episode.episodeFileId))
    .filter((id) => id > 0))];
  for (const fileId of fileIds) {
    await jsonRequest<unknown>(apiUrl(settings.services.sonarr, `/api/v3/episodefile/${fileId}`), {
      method: 'DELETE', headers: jsonHeaders(settings.services.sonarr)
    }, { service: 'Sonarr', action: 'afleveringsbestand verwijderen' });
  }
  const seasons = (series.seasons ?? []).map((season: any) => targetSeasons.includes(Number(season.seasonNumber)) ? { ...season, monitored: false } : season);
  await jsonRequest<unknown>(apiUrl(settings.services.sonarr, `/api/v3/series/${series.id}`), {
    method: 'PUT', headers: jsonHeaders(settings.services.sonarr), body: JSON.stringify({ ...series, seasons })
  }, { service: 'Sonarr', action: 'seizoen deactiveren' });
  return targetSeasons.length === 1
    ? `${fileIds.length} seizoenbestanden verwijderd en seizoen gedemonitord in Sonarr.`
    : `${fileIds.length} bestanden uit ${targetSeasons.length} seizoenen verwijderd en gedemonitord in Sonarr.`;
}
