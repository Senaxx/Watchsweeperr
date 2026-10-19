import { describe, expect, it, vi } from 'vitest';
import type { AppSettings, AppState, Suggestion } from '../shared.js';
import { automaticRemovalCandidates, runAutomaticRemovals } from './automaticRemoval.js';

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
    const removeMedia = vi.fn(async () => 'film');
    const removeSeasonGroup = vi.fn(async () => 'seizoenen verwijderd');
    const deleteSeerrRequest = vi.fn(async () => 'Seerr-verzoek verwijderd');

    const result = await runAutomaticRemovals(settings, state, { removeMedia, removeSeasonGroup, deleteSeerrRequest }, new Date('2026-09-10T00:00:00Z'));

    expect(result).toEqual({ removed: 1, failed: 0 });
    expect(removeMedia).not.toHaveBeenCalled();
    expect(removeSeasonGroup).toHaveBeenCalledWith(settings, expect.arrayContaining([expect.objectContaining({ seasonNumber: 1 }), expect.objectContaining({ seasonNumber: 2 })]));
    expect(deleteSeerrRequest).toHaveBeenCalledTimes(1);
    expect(state.suggestions.every((item) => item.status === 'removed')).toBe(true);
  });

  it('verwijdert alle samengevoegde Seerr-verzoeken', async () => {
    const duplicateMovie = { ...movie, requestIds: [12, 13] };
    const state: AppState = { suggestions: [duplicateMovie], ignoredSuggestionIds: [], activity: [] };
    const removeMedia = vi.fn(async () => 'film verwijderd');
    const removeSeasonGroup = vi.fn(async () => 'seizoenen verwijderd');
    const deleteSeerrRequest = vi.fn(async (_service, requestId: number) => `verzoek ${requestId} verwijderd`);

    const result = await runAutomaticRemovals(settings, state, { removeMedia, removeSeasonGroup, deleteSeerrRequest }, new Date('2026-09-10T00:00:00Z'));

    expect(result).toEqual({ removed: 1, failed: 0 });
    expect(deleteSeerrRequest.mock.calls.map((call) => call[1])).toEqual([12, 13]);
    expect(state.suggestions[0]?.status).toBe('removed');
  });
});
