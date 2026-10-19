import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../shared.js';
import { scanRequests, testing } from './syncEngine.js';

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sync matching', () => {
  it('houdt verlopen aanvragen bij hun echte kijkstatus', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z'));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/request') return Response.json({
        results: [
          { id: 1, type: 'movie', createdAt: '2026-09-02T08:49:38Z', media: { tmdbId: 822119, mediaAddedAt: '2026-09-02T10:39:05Z' }, requestedBy: { plexUsername: 'TonyK08' } },
          { id: 2, type: 'tv', createdAt: '2026-07-25T16:09:13Z', media: { tmdbId: 287620, mediaAddedAt: '2026-07-25T16:16:05Z' }, requestedBy: { plexUsername: 'carla_j' }, seasons: [{ seasonNumber: 1 }] }
        ],
        pageInfo: { results: 2 }
      });
      if (url.pathname === '/api/v1/movie/822119') return Response.json({ originalTitle: 'Captain America: Brave New World', releaseDate: '2025-02-12' });
      if (url.pathname === '/api/v1/tv/287620') return Response.json({
        originalName: 'Stuart Fails to Save the Universe', firstAirDate: '2026-07-01',
        externalIds: { tvdbId: 1234 }, seasons: [{ seasonNumber: 1, episodeCount: 10, airDate: '2026-07-01' }]
      });
      if (url.pathname === '/api/v3/movie') return Response.json([{ tmdbId: 822119, hasFile: true }]);
      if (url.pathname === '/api/v3/series') return Response.json([{ tvdbId: 1234, seasons: [{ seasonNumber: 1, statistics: { episodeFileCount: 10 } }] }]);
      if (url.pathname === '/api/v3/diskspace') return Response.json([]);
      if (url.pathname === '/api/v2' && url.searchParams.get('cmd') === 'get_history') {
        const episodes = url.searchParams.get('media_type') === 'episode';
        const data = episodes ? Array.from({ length: 9 }, (_, index) => ({
          grandparent_title: 'Stuart Fails to Save the Universe', parent_media_index: 1,
          media_index: index + 1, watched_status: 1, date: 1790000000
        })) : [];
        return Response.json({ response: { result: 'success', data: { recordsFiltered: data.length, data } } });
      }
      throw new Error(`Onverwachte test-URL: ${url}`);
    }));

    const result = await scanRequests({ ...settings, retentionMonths: 0, retentionDays: 5 });
    expect(result.suggestions.map(({ title, status, progress, suggestionBasis }) => ({ title, status, progress, suggestionBasis }))).toEqual([
      { title: 'Captain America: Brave New World', status: 'waiting', progress: 0, suggestionBasis: 'retention' },
      { title: 'Stuart Fails to Save the Universe', status: 'partial', progress: 90, suggestionBasis: 'retention' }
    ]);
  });

  it('slaat een defect Seerr-media-item over en verwerkt volgende verzoeken', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/api/v1/request?')) return Response.json({
        results: [
          { id: 41, type: 'movie', createdAt: '2026-09-01T00:00:00Z', media: { tmdbId: 1195571 }, requestedBy: { plexUsername: 'Tester' } },
          { id: 42, type: 'movie', createdAt: '2026-09-02T00:00:00Z', media: { tmdbId: 2 }, requestedBy: { plexUsername: 'Tester' } }
        ],
        pageInfo: { results: 2 }
      });
      if (url.includes('/api/v1/movie/1195571?language=nl')) return Response.json(
        { message: 'Unable to retrieve movie.' },
        { status: 500, statusText: 'Internal Server Error' }
      );
      if (url.includes('/api/v1/movie/2?language=nl')) return Response.json({ title: 'Werkende film', originalTitle: 'Working Movie', releaseDate: '2025-01-01', status: 'Released' });
      if (url.endsWith('/api/v3/movie')) return Response.json([
        { tmdbId: 1195571, hasFile: true, sizeOnDisk: 100 },
        { tmdbId: 2, hasFile: true, sizeOnDisk: 200 }
      ]);
      if (url.endsWith('/api/v3/series') || url.includes('/api/v3/diskspace')) return Response.json([]);
      if (url.includes('cmd=get_history')) return Response.json({ response: { result: 'success', data: { recordsFiltered: 0, data: [] } } });
      throw new Error(`Onverwachte test-URL: ${url}`);
    }));

    const result = await scanRequests(settings);

    expect(result.suggestions.map((item) => item.title)).toEqual(['Working Movie']);
    expect((result as any).warnings).toEqual([expect.objectContaining({ requestIds: [41], tmdbId: 1195571 })]);
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('voegt dubbele Seerr-filmverzoeken van dezelfde aanvrager samen', () => {
    const requests = [
      { id: 28, type: 'movie', createdAt: '2026-04-25T15:18:59Z', media: { tmdbId: 109445 }, requestedBy: { plexUsername: 'VCBeugelaar' } },
      { id: 27, type: 'movie', createdAt: '2026-04-25T07:23:39Z', media: { tmdbId: 109445 }, requestedBy: { plexUsername: 'VCBeugelaar' } },
      { id: 29, type: 'movie', createdAt: '2026-04-25T08:00:00Z', media: { tmdbId: 109445 }, requestedBy: { plexUsername: 'Andere gebruiker' } }
    ];

    const groups = testing.deduplicateSeerrRequests(requests);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.request.id).toBe(27);
    expect(groups[0]?.requestIds).toEqual([28, 27]);
    expect(groups[1]?.requestIds).toEqual([29]);
  });

  it('normaliseert leestekens en accenten', () => {
    expect(testing.normalize('Dune: Part Two')).toBe('dune part two');
    expect(testing.normalize('Pokémon')).toBe('pokemon');
  });

  it('gebruikt oorspronkelijke titel en Seerr-posterpad', () => {
    const details = {
      title: 'Obsessie',
      originalTitle: 'Obsession',
      posterPath: '/poster.jpg'
    };
    expect(testing.originalTitle(details)).toBe('Obsession');
    expect(testing.posterUrl(details)).toBe('https://image.tmdb.org/t/p/w185/poster.jpg');
    expect(testing.posterUrl({})).toBeUndefined();
  });

  it('berekent bekeken percentage uit offsets', () => {
    expect(testing.percent({ duration: 1000, watched: 925 })).toBe(92.5);
    expect(testing.percent({ watched_status: 1 })).toBe(100);
  });

  it('vertrouwt Tautulli bekeken-status boven een lager percentage', () => {
    expect(testing.percent({ watched_status: 1, percent_complete: 86 })).toBe(100);
  });

  it('behandelt ontbrekende kijkhistorie als niet bekeken', () => {
    expect(testing.percent(undefined)).toBe(0);
  });

  it('weigert gelijknamige titels uit een ander jaar', () => {
    expect(testing.titleMatches({ title: 'Dune', year: 2021 }, 'Dune', 2021)).toBe(true);
    expect(testing.titleMatches({ title: 'Dune', year: 1984 }, 'Dune', 2021)).toBe(false);
  });

  it('telt een serie met een langere titel die de gevraagde titel bevat niet mee', () => {
    expect(testing.episodeMatchesSeries({ grandparent_title: 'Young Sheldon', parent_media_index: 1 }, 'You', 1)).toBe(false);
    expect(testing.titleMatches({ title: 'Upgrade', year: 2018 }, 'Up', 2018)).toBe(false);
  });

  it('leest kijkdatums in seconden en milliseconden hetzelfde', () => {
    expect(testing.historyDate(1787602897)).toBe('2026-08-24T20:21:37.000Z');
    expect(testing.historyDate(1787602897000)).toBe('2026-08-24T20:21:37.000Z');
    expect(testing.historyDate(undefined)).toBeUndefined();
  });

  it('matcht een later seizoen zonder afleveringsjaar als seriejaar te gebruiken', () => {
    expect(testing.episodeMatchesSeries({
      grandparent_title: 'Loki',
      year: 2023,
      parent_media_index: 2
    }, 'Loki', 2)).toBe(true);
  });

  it('gebruikt exacte TMDB-ID ondanks een afwijkende filmtitel', () => {
    const history = [{ title: 'Volledig andere titel', year: 1999, tautulliExternalIds: { tmdbId: 123 } }];
    expect(testing.matchingHistory(history, 'movie', 123, ['Obsession'], 2026)).toEqual({
      items: history,
      method: 'external-id'
    });
  });

  it('gebruikt titel en jaar alleen wanneer externe Plex-metadata ontbreekt', () => {
    const oldHistory = [{ title: 'Obsession', year: 2026 }];
    expect(testing.matchingHistory(oldHistory, 'movie', 123, ['Obsession'], 2026)).toEqual({
      items: oldHistory,
      method: 'title-year'
    });

    const wrongId = [{ title: 'Obsession', year: 2026, tautulliExternalIds: { tmdbId: 999 } }];
    expect(testing.matchingHistory(wrongId, 'movie', 123, ['Obsession'], 2026)).toEqual({
      items: [],
      method: 'none'
    });
  });

  it('matcht series exact op TVDB-ID en daarna op seizoen', () => {
    const correct = { grandparent_title: 'Andere titel', parent_media_index: 2, tautulliExternalIds: { tvdbId: 270408 } };
    const wrongSeason = { ...correct, parent_media_index: 1 };
    expect(testing.matchingHistory([correct, wrongSeason], 'episode', 270408, ['Outlander'], 2014, 2)).toEqual({
      items: [correct],
      method: 'external-id'
    });
  });

  it('leest Unix-milliseconden als echte kijkdatum', () => {
    expect(testing.toDate(1787602897 * 1000)).toBe('2026-08-24T20:21:37.000Z');
  });

  it('negeert films met een toekomstige releasedatum', () => {
    const today = new Date('2026-09-17T12:00:00Z');
    expect(testing.movieIsReleased({ releaseDate: '2026-09-23', status: 'Released' }, today)).toBe(false);
    expect(testing.movieIsReleased({ releaseDate: '2026-09-16', status: 'Released' }, today)).toBe(true);
    expect(testing.movieIsReleased({ status: 'Post Production' }, today)).toBe(false);
  });

  it('negeert alleen seizoenen die nog niet begonnen zijn', () => {
    const today = new Date('2026-09-17T12:00:00Z');
    const details = {
      firstAirDate: '2021-06-09',
      lastEpisodeToAir: { seasonNumber: 2 },
      seasons: [
        { seasonNumber: 2, airDate: '2023-10-05' },
        { seasonNumber: 3, airDate: '2027-01-08' }
      ]
    };
    expect(testing.seasonIsReleased(details, 2, today)).toBe(true);
    expect(testing.seasonIsReleased(details, 3, today)).toBe(false);
  });

  it('start bewaartermijn wanneer zowel aanvraag als media beschikbaar zijn', () => {
    expect(testing.retentionStart('2026-01-01T00:00:00Z', '2026-02-15T00:00:00Z')).toBe('2026-02-15T00:00:00.000Z');
    expect(testing.retentionStart('2026-03-10T00:00:00Z', '2025-12-01T00:00:00Z')).toBe('2026-03-10T00:00:00.000Z');
  });

  it('controleert bewaartermijn in kalendermaanden', () => {
    const start = '2026-03-10T00:00:00.000Z';
    expect(testing.retentionExpired(start, 3, new Date('2026-06-09T23:59:59Z'))).toBe(false);
    expect(testing.retentionExpired(start, 3, new Date('2026-06-10T00:00:00Z'))).toBe(false);
    expect(testing.retentionExpired(start, 3, new Date('2026-06-10T00:00:01Z'))).toBe(true);
  });

  it('ondersteunt een extra aantal dagen en kalendermaanden aan het maandeinde', () => {
    const start = '2026-01-31T12:00:00Z';
    expect(testing.retentionExpired(start, 1, new Date('2026-03-01T11:59:59Z'))).toBe(true);
    expect(testing.retentionExpired(start, 1, new Date('2026-03-02T12:00:00Z'), 2)).toBe(false);
    expect(testing.retentionExpired(start, 1, new Date('2026-03-02T12:00:01Z'), 2)).toBe(true);
    expect(testing.retentionExpired('ongeldig', 3)).toBe(false);
  });

  it('bepaalt voltooiingsmoment voor automatisering alleen na de aanvraag', () => {
    const requestedAt = '2026-09-10T12:00:00.000Z';
    expect(testing.watchedAfterRequestAt([
      { watched_status: 1, date: Date.parse('2026-09-09T12:00:00.000Z') / 1000 },
      { percent_complete: 94, date: Date.parse('2026-09-11T12:00:00.000Z') / 1000 }
    ], requestedAt, 95)).toBeUndefined();
    expect(testing.watchedAfterRequestAt([
      { percent_complete: 96, date: Date.parse('2026-09-11T12:00:00.000Z') / 1000 }
    ], requestedAt, 95)).toBe('2026-09-11T12:00:00.000Z');
  });
});
