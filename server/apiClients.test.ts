import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, Suggestion } from '../shared.js';
import { deleteSeerrRequest, getDownloadAvailability, getSeerrMediaDetails, getSeerrRequests, getTautulliHistoryWithMetadata, removeMedia, removeSeasonGroup, seasonDownloadKey, testService } from './apiClients.js';

const settings: AppSettings = {
  language: 'nl',
  demoMode: false,
  watchThreshold: 90,
  retentionMonths: 3,
  retentionDays: 0,
  excludedUsers: [],
  ignoredGenres: [],
  automaticRemovalRules: [],
  services: {
    seerr: { url: 'http://seerr', apiKey: 'key' },
    tautulli: { url: 'http://tautulli', apiKey: 'key' },
    radarr: { url: 'http://radarr', apiKey: 'key' },
    sonarr: { url: 'http://sonarr', apiKey: 'key' }
  }
};

function suggestion(overrides: Partial<Suggestion>): Suggestion {
  return {
    id: 'test', requestId: 1, mediaKind: 'season', title: 'Test', subtitle: 'Seizoen 2', requester: 'User',
    requestedAt: new Date().toISOString(), progress: 100, watchedItems: 2, totalItems: 2, status: 'ready',
    reason: 'bekeken', matchConfidence: 'high', ...overrides
  };
}

afterEach(() => vi.restoreAllMocks());

describe('duidelijke servicefouten', () => {
  it('controleert bij Seerr ook toegang tot verzoeken', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/api/v1/status')) return Response.json({ version: '3.4.1' });
      return Response.json({ results: [], pageInfo: { results: 0 } });
    }));

    await expect(testService('seerr', settings.services.seerr)).resolves.toBe('3.4.1');
    expect(calls.some((url) => url.includes('/api/v1/request?'))).toBe(true);
  });

  it('noemt service, handeling en rechten bij een 403', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { status: 403, error: 'You do not have permission to access this endpoint' },
      { status: 403, statusText: 'Forbidden' }
    )));

    await expect(getSeerrRequests(settings.services.seerr)).rejects.toThrow(
      'Seerr: verzoeken lezen mislukt (403). Controleer of de API-key toegang tot deze functie heeft.'
    );
  });

  it('vraagt Seerr-mediagegevens in de ingestelde taal op', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return Response.json({ genres: [{ id: 16, name: 'Animation' }] });
    }));

    await getSeerrMediaDetails(settings.services.seerr, 'movie', 123, 'en');

    expect(calls).toEqual(['http://seerr/api/v1/movie/123?language=en']);
  });
});

describe('Tautulli externe IDs', () => {
  it('verrijkt films en afleveringen via get_metadata zonder API-key in URL', async () => {
    const calls: Array<{ url: string; headers?: HeadersInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); calls.push({ url, headers: init?.headers });
      if (url.includes('cmd=get_history')) return Response.json({ response: { result: 'success', data: { recordsFiltered: 1, data: [{ rating_key: '4591', grandparent_rating_key: '4580' }] } } });
      return Response.json({ response: { result: 'success', data: { guids: ['tmdb://6922717'], grandparent_guids: ['tvdb://270408'] } } });
    }));

    const movies = await getTautulliHistoryWithMetadata(settings.services.tautulli, 'Tony', 'movie');
    const episodes = await getTautulliHistoryWithMetadata(settings.services.tautulli, 'Tony', 'episode');

    expect(movies[0]?.tautulliExternalIds).toEqual({ tmdbId: 6922717 });
    expect(episodes[0]?.tautulliExternalIds).toEqual({ tvdbId: 270408 });
    expect(calls.every((call) => !call.url.includes('apikey='))).toBe(true);
    expect(calls.every((call) => (call.headers as Record<string, string>)?.['X-Api-Key'] === 'key')).toBe(true);
  });
});

describe('removeMedia', () => {
  it('verwijdert alleen bestanden uit het gekozen seizoen en zet dat seizoen uit', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body as string | undefined });
      if (url.endsWith('/api/v3/series?tvdbId=555')) return Response.json([{ id: 7, tvdbId: 555, seasons: [
        { seasonNumber: 1, monitored: true, statistics: { episodeFileCount: 3 } },
        { seasonNumber: 2, monitored: true, statistics: { episodeFileCount: 2 } }
      ] }]);
      if (url.includes('/api/v3/episode?')) return Response.json([
        { seasonNumber: 1, episodeFileId: 11 },
        { seasonNumber: 2, episodeFileId: 21 },
        { seasonNumber: 2, episodeFileId: 22 }
      ]);
      return new Response(null, { status: 204 });
    }));

    const result = await removeMedia(settings, suggestion({ tvdbId: 555, seasonNumber: 2 }));
    const deletes = calls.filter((call) => call.method === 'DELETE').map((call) => call.url);
    expect(deletes).toHaveLength(2);
    expect(deletes.some((url) => url.endsWith('/episodefile/11'))).toBe(false);
    expect(deletes.some((url) => url.endsWith('/episodefile/21'))).toBe(true);
    expect(deletes.some((url) => url.endsWith('/episodefile/22'))).toBe(true);
    const update = calls.find((call) => call.method === 'PUT');
    expect(JSON.parse(update?.body ?? '{}').seasons).toEqual([
      { seasonNumber: 1, monitored: true, statistics: { episodeFileCount: 3 } },
      { seasonNumber: 2, monitored: false, statistics: { episodeFileCount: 2 } }
    ]);
    expect(result).toContain('2 seizoenbestanden');
  });

  it('verwijdert hele serie en map wanneer dit laatste seizoen met bestanden is', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method });
      if (url.endsWith('/api/v3/series?tvdbId=777')) return Response.json([{ id: 8, tvdbId: 777, seasons: [
        { seasonNumber: 1, statistics: { episodeFileCount: 0 } },
        { seasonNumber: 2, statistics: { episodeFileCount: 6 } }
      ] }]);
      return new Response(null, { status: 204 });
    }));

    const result = await removeMedia(settings, suggestion({ tvdbId: 777, seasonNumber: 2 }));
    const seriesDelete = calls.find((call) => call.method === 'DELETE');
    expect(seriesDelete?.url).toContain('/api/v3/series/8');
    expect(seriesDelete?.url).toContain('deleteFiles=true');
    expect(seriesDelete?.url).toContain('addImportListExclusion=false');
    expect(calls.some((call) => call.url.includes('/episodefile/'))).toBe(false);
    expect(result).toContain('volledige seriemap');
  });

  it('accepteert lege Radarr DELETE-responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'DELETE') return new Response(null, { status: 204 });
      return Response.json([{ id: 9, tmdbId: 123 }]);
    }));

    await expect(removeMedia(settings, suggestion({ mediaKind: 'movie', tmdbId: 123 }))).resolves.toContain('Radarr');
  });

  it('is opnieuw uitvoerbaar wanneer media al uit Radarr is verwijderd', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
    await expect(removeMedia(settings, suggestion({ mediaKind: 'movie', tmdbId: 123 }))).resolves.toContain('al verwijderd');
  });
});

describe('removeSeasonGroup', () => {
  it('verwijdert volledige serie wanneer groep alle gedownloade seizoenen bevat', async () => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); const method = init?.method ?? 'GET'; calls.push({ url, method });
      if (url.endsWith('/api/v3/series?tvdbId=600')) return Response.json([{ id: 8, tvdbId: 600, seasons: [
        { seasonNumber: 1, statistics: { episodeFileCount: 10 } },
        { seasonNumber: 2, statistics: { episodeFileCount: 10 } }
      ] }]);
      return new Response(null, { status: 204 });
    }));

    const result = await removeSeasonGroup(settings, [suggestion({ tvdbId: 600, seasonNumber: 1 }), suggestion({ tvdbId: 600, seasonNumber: 2 })]);
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    expect(calls.find((call) => call.method === 'DELETE')?.url).toContain('/api/v3/series/8');
    expect(result).toContain('volledige seriemap');
  });
});

describe('Seerr-verzoek verwijderen', () => {
  it('verwijdert request via het request-id', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteSeerrRequest(settings.services.seerr, 42)).resolves.toContain('verwijderd');
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://seerr/api/v1/request/42');
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('behandelt een al verwijderd Seerr-verzoek als succes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(deleteSeerrRequest(settings.services.seerr, 42)).resolves.toContain('al verwijderd');
  });
});

describe('downloadbeschikbaarheid', () => {
  it('neemt alleen films en seizoenen met bestanden mee', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/v3/movie')) return Response.json([
        { tmdbId: 101, hasFile: true, sizeOnDisk: 4_294_967_296 },
        { tmdbId: 102, hasFile: false }
      ]);
      if (url.endsWith('/api/v3/series')) return Response.json([
        {
          tvdbId: 500,
          statistics: { episodeFileCount: 8 },
          seasons: [
            { seasonNumber: 1, statistics: { episodeFileCount: 8, sizeOnDisk: 8_589_934_592 } },
            { seasonNumber: 2, statistics: { episodeFileCount: 0 } }
          ]
        }
      ]);
      if (url === 'http://radarr/api/v3/diskspace') return Response.json([
        { path: '/media', freeSpace: 100, totalSpace: 1000 },
        { path: '/archive', freeSpace: 50, totalSpace: 500 }
      ]);
      if (url === 'http://sonarr/api/v3/diskspace') return Response.json([
        { path: '/media', freeSpace: 100, totalSpace: 1000 }
      ]);
      return Response.json([]);
    }));

    const availability = await getDownloadAvailability(settings);

    expect([...availability.movieTmdbIds]).toEqual([101]);
    expect([...availability.seasonKeys]).toEqual([seasonDownloadKey(500, 1)]);
    expect(availability.movieFileSizes.get(101)).toBe(4_294_967_296);
    expect(availability.seasonFileSizes.get(seasonDownloadKey(500, 1))).toBe(8_589_934_592);
    expect(availability.serverStatistics).toMatchObject({ movies: 1, episodes: 8, freeSpaceBytes: 150 });
    expect(availability.serverStatistics.updatedAt).toBeTruthy();
  });
});
