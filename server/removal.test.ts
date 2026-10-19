import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, AppState, Suggestion } from '../shared.js';
import { automaticRemovalCandidates, groupSuggestionsForRemoval, runAutomaticRemovals } from './removal.js';

const settings: AppSettings = {
  language: 'nl',
  demoMode: false,
  watchThreshold: 95,
  retentionMonths: 2,
  retentionDays: 0,
  excludedUsers: [],
  ignoredGenres: [],
  automaticRemovalRules: [{ requester: 'Tony', movies: true, series: true, delayDays: 7 }],
  services: {
    seerr: { url: 'http://seerr', apiKey: 'key' },
    tautulli: { url: 'http://tautulli', apiKey: 'key' },
    radarr: { url: 'http://radarr', apiKey: 'key' },
    sonarr: { url: 'http://sonarr', apiKey: 'key' }
  }
};

const movie: Suggestion = {
  id: 'request-12-movie', requestId: 12, mediaKind: 'movie', title: 'Testfilm', subtitle: 'Film', requester: 'Tony',
  requestedAt: '2026-09-01T00:00:00.000Z', lastWatchedAt: '2026-09-02T00:00:00.000Z',
  watchedAfterRequestAt: '2026-09-02T00:00:00.000Z', progress: 100, watchedItems: 1, totalItems: 1,
  status: 'ready', reason: '100% bekeken door aanvrager', matchConfidence: 'high', matchMethod: 'external-id', suggestionBasis: 'watched', tmdbId: 123
};

const season = (seasonNumber: number): Suggestion => ({
  ...movie,
  id: `request-20-season-${seasonNumber}`,
  requestId: 20,
  mediaKind: 'season',
  title: 'Testserie',
  subtitle: `Seizoen ${seasonNumber}`,
  tmdbId: 500,
  tvdbId: 600,
  seasonNumber,
  requestedSeasonNumbers: [1, 2],
  watchedItems: 10,
  totalItems: 10
});

describe('automatische verwijdering', () => {
  it('respecteert configureerbare wachtdagen voor films', () => {
    expect(automaticRemovalCandidates([movie], settings, new Date('2026-09-08T23:59:59Z'))).toEqual([]);
    expect(automaticRemovalCandidates([movie], settings, new Date('2026-09-09T00:00:00Z')).map((item) => item.requestId)).toEqual([12]);
  });

  it('vereist alle aangevraagde seizoenen voordat serieverzoek automatisch wordt verwijderd', () => {
    expect(automaticRemovalCandidates([season(1)], settings, new Date('2026-09-10T00:00:00Z'))).toEqual([]);
    const candidates = automaticRemovalCandidates([season(1), season(2)], settings, new Date('2026-09-10T00:00:00Z'));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.suggestions.map((item) => item.seasonNumber)).toEqual([1, 2]);
  });

  it('respecteert aparte films- en serieschakelaars', () => {
    const movieOnly = { ...settings, automaticRemovalRules: [{ requester: 'Tony', movies: true, series: false, delayDays: 0 }] };
    const seriesOnly = { ...settings, automaticRemovalRules: [{ requester: 'Tony', movies: false, series: true, delayDays: 0 }] };
    expect(automaticRemovalCandidates([season(1), season(2)], movieOnly, new Date('2026-09-10T00:00:00Z'))).toEqual([]);
    expect(automaticRemovalCandidates([movie], seriesOnly, new Date('2026-09-10T00:00:00Z'))).toEqual([]);
  });

  it('slaat retentie, zwakke matches, uitgesloten gebruikers en demomodus over', () => {
    expect(automaticRemovalCandidates([{ ...movie, suggestionBasis: 'retention' }], settings, new Date('2026-09-10T00:00:00Z'))).toEqual([]);
    expect(automaticRemovalCandidates([{ ...movie, matchConfidence: 'low' }], settings, new Date('2026-09-10T00:00:00Z'))).toEqual([]);
    expect(automaticRemovalCandidates([movie], { ...settings, excludedUsers: [' tOnY '] }, new Date('2026-09-10T00:00:00Z'))).toEqual([]);
    expect(automaticRemovalCandidates([movie], { ...settings, demoMode: true }, new Date('2026-09-10T00:00:00Z'))).toEqual([]);
  });

  it('weigert automatische verwijdering bij titel- en jaarfallback', () => {
    expect(automaticRemovalCandidates([{ ...movie, matchMethod: 'title-year' }], settings, new Date('2026-09-10T00:00:00Z'))).toEqual([]);
  });

  it('verwijdert een compleet serieverzoek als één groep', async () => {
    const state: AppState = { suggestions: [season(1), season(2)], ignoredSuggestionIds: [], activity: [] };
    const calls = fakeServices({ series: [{ id: 8, tvdbId: 600, seasons: [1, 2].map((seasonNumber) => ({ seasonNumber, statistics: { episodeFileCount: 10 } })) }] });

    const result = await runAutomaticRemovals(settings, state, new Date('2026-09-10T00:00:00Z'));

    expect(result).toEqual({ removed: 1, failed: 0 });
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual(['/api/v3/series/8', '/api/v1/request/20']);
    expect(state.suggestions.every((item) => item.status === 'removed')).toBe(true);
    expect(state.activity[0]?.title).toBe('Testserie automatisch verwijderd');
  });

  it('verwijdert alle samengevoegde Seerr-verzoeken', async () => {
    const state: AppState = { suggestions: [{ ...movie, requestIds: [12, 13] }], ignoredSuggestionIds: [], activity: [] };
    const calls = fakeServices({ movies: [{ id: 5, tmdbId: 123 }] });

    const result = await runAutomaticRemovals(settings, state, new Date('2026-09-10T00:00:00Z'));

    expect(result).toEqual({ removed: 1, failed: 0 });
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.path)).toEqual(['/api/v3/movie/5', '/api/v1/request/12', '/api/v1/request/13']);
    expect(state.suggestions[0]?.status).toBe('removed');
  });

  it('verwijdert een genegeerde titel nooit automatisch', async () => {
    const state: AppState = { suggestions: [movie], ignoredSuggestionIds: [movie.id], activity: [] };
    const calls = fakeServices({ movies: [{ id: 5, tmdbId: 123 }] });

    expect(await runAutomaticRemovals(settings, state, new Date('2026-09-10T00:00:00Z'))).toEqual({ removed: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it('logt een mislukte automatische verwijdering en probeert het later opnieuw', async () => {
    const state: AppState = { suggestions: [movie], ignoredSuggestionIds: [], activity: [] };
    fakeServices({ movies: [{ id: 5, tmdbId: 123 }], failMovieDelete: true });

    const result = await runAutomaticRemovals(settings, state, new Date('2026-09-10T00:00:00Z'));

    expect(result).toEqual({ removed: 0, failed: 1 });
    expect(state.suggestions[0]?.status).toBe('ready');
    expect(state.activity[0]).toMatchObject({ title: 'Automatisch verwijderen mislukt: Testfilm', outcome: 'error' });
  });
});

describe('groeperen voor verwijderen', () => {
  it('groepeert seizoenen van dezelfde serie voor veilig bulkverwijderen', () => {
    const groups = groupSuggestionsForRemoval([
      { ...movie, id: 'movie-1' },
      { ...season(1), id: 'season-1', tvdbId: 99 },
      { ...season(2), id: 'season-2', tvdbId: 99 }
    ]);
    expect(groups.map((group) => group.map((item) => item.id))).toEqual([['movie-1'], ['season-1', 'season-2']]);
  });
});

afterEach(() => vi.unstubAllGlobals());

// Fake Radarr, Sonarr and Seerr: answers lookups with the given items, records every call.
function fakeServices({ movies = [], series = [], failMovieDelete = false }: { movies?: unknown[]; series?: unknown[]; failMovieDelete?: boolean }) {
  const calls: { method: string; path: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    calls.push({ method, path: url.pathname });
    if (method === 'GET' && url.pathname === '/api/v3/movie') return Response.json(movies);
    if (method === 'GET' && url.pathname === '/api/v3/series') return Response.json(series);
    if (failMovieDelete && method === 'DELETE' && url.pathname.startsWith('/api/v3/movie/')) return new Response('kapot', { status: 500 });
    return new Response(null, { status: 200 });
  }));
  return calls;
}
