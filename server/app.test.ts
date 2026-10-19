import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Suggestion } from '../shared.js';
import { createApp, testing } from './app.js';

const suggestion: Suggestion = {
  id: 'request-12-movie', requestId: 12, mediaKind: 'movie', title: 'Testfilm', subtitle: 'Film', requester: 'Tony',
  requestedAt: '2026-09-01T00:00:00.000Z', progress: 0, watchedItems: 0, totalItems: 1, status: 'waiting',
  reason: 'Nog niet bekeken', matchConfidence: 'high'
};

afterEach(() => vi.restoreAllMocks());

describe('API-foutmeldingen', () => {
  it('geeft service en handeling terug bij onvoldoende Seerr-rechten', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/v1/status')) return Response.json({ version: '3.4.1' });
      return Response.json(
        { status: 403, error: 'You do not have permission to access this endpoint' },
        { status: 403, statusText: 'Forbidden' }
      );
    }));

    const response = await request(createApp())
      .post('/api/services/seerr/test')
      .send({ url: 'http://seerr', apiKey: 'verkeerd' });

    expect(response.status).toBe(502);
    expect(response.body.error).toContain('Seerr: verzoeken lezen mislukt (403)');
    expect(response.body.error).toContain('Controleer of de API-key toegang tot deze functie heeft');
  });
});

describe('genegeerde voorstellen', () => {
  it('staat handmatig verwijderen toe voor alle actieve kijkstatussen', () => {
    expect(testing.canManuallyRemove({ ...suggestion, status: 'waiting' })).toBe(true);
    expect(testing.canManuallyRemove({ ...suggestion, status: 'ready' })).toBe(true);
    expect(testing.canManuallyRemove({ ...suggestion, status: 'partial' })).toBe(true);
    expect(testing.canManuallyRemove({ ...suggestion, status: 'dismissed' })).toBe(false);
  });

  it('blijven na een nieuwe scan genegeerd', () => {
    const [result] = testing.applyIgnoredSuggestions([suggestion], [suggestion.id]);
    expect(result.status).toBe('dismissed');
    expect(result.reason).toBe('Handmatig genegeerd');
    expect(result.statusBeforeDismiss).toBe('waiting');
    expect(result.reasonBeforeDismiss).toBe('Nog niet bekeken');
  });

  it('laat niet-genegeerde voorstellen ongewijzigd', () => {
    const [result] = testing.applyIgnoredSuggestions([suggestion], []);
    expect(result.status).toBe('waiting');
  });

  it('filtert uitgesloten aanvragers hoofdletterongevoelig', () => {
    const suggestions = [suggestion, { ...suggestion, id: 'other', requester: 'Sanne' }];
    expect(testing.filterExcludedSuggestions(suggestions, [' tOnY ']).map((item) => item.requester)).toEqual(['Sanne']);
  });

  it('filtert ingestelde genres hoofdletterongevoelig', () => {
    const suggestions = [
      { ...suggestion, id: 'animation', genres: ['Animation', 'Family'] },
      { ...suggestion, id: 'drama', genres: ['Drama'] }
    ];
    expect(testing.filterIgnoredGenres(suggestions, [' animation ']).map((item) => item.id)).toEqual(['drama']);
  });

  it('toont onvolledig bekeken aanvragen pas na de ingestelde maanden en dagen, volledig bekeken altijd', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    const suggestions = [
      { ...suggestion, id: 'old-waiting', requestedAt: '2026-06-21T11:59:59Z', status: 'waiting' as const },
      { ...suggestion, id: 'boundary', requestedAt: '2026-06-21T12:00:00Z', status: 'partial' as const },
      { ...suggestion, id: 'recent-watched', requestedAt: '2026-09-01T00:00:00Z', status: 'ready' as const }
    ];
    expect(testing.filterRecentRequests(suggestions, 3, 5, now).map((item) => item.id)).toEqual(['old-waiting', 'recent-watched']);
  });

  it('telt verborgen open verzoeken per reden, zonder genegeerde of getoonde items', () => {
    const settings = {
      demoMode: false, excludedUsers: ['senaxx'], ignoredGenres: ['Horror'], retentionMonths: 0, retentionDays: 30
    } as unknown as Parameters<typeof testing.visibleSuggestions>[1];
    const old = '2026-01-01T00:00:00Z';
    const recent = new Date().toISOString();
    const suggestions = [
      { ...suggestion, id: 'excluded', requester: 'Senaxx', requestedAt: old },
      { ...suggestion, id: 'genre', genres: ['Horror'], requestedAt: old },
      { ...suggestion, id: 'recent', requestedAt: recent },
      { ...suggestion, id: 'shown-ready', status: 'ready' as const, requestedAt: recent },
      { ...suggestion, id: 'ignored', status: 'dismissed' as const, requester: 'Senaxx', requestedAt: old }
    ];
    const live = testing.visibleSuggestions(suggestions, settings);
    expect(live.hidden).toEqual({ excludedUsers: 1, ignoredGenres: 1, notYetDue: 1 });
    expect(live.suggestions.map((item) => item.id)).toEqual(['shown-ready']);
    expect(testing.visibleSuggestions(suggestions, { ...settings, demoMode: true }).hidden).toEqual({ excludedUsers: 1, ignoredGenres: 1, notYetDue: 0 });
  });

  it('rekent de bewaartermijn vanaf beschikbaarheid, niet vanaf de oude aanvraag', () => {
    const now = new Date('2026-09-26T12:00:00Z');
    const lateArrival = { ...suggestion, requestedAt: '2026-03-01T00:00:00Z', availableSince: '2026-09-20T00:00:00Z' };
    expect(testing.filterRecentRequests([lateArrival], 3, 5, now)).toEqual([]);
  });

  it('groepeert seizoenen van dezelfde serie voor veilig bulkverwijderen', () => {
    const groups = testing.groupSuggestionsForRemoval([
      { ...suggestion, id: 'movie-1', status: 'ready' },
      { ...suggestion, id: 'season-1', mediaKind: 'season', tvdbId: 99, seasonNumber: 1, status: 'ready' },
      { ...suggestion, id: 'season-2', mediaKind: 'season', tvdbId: 99, seasonNumber: 2, status: 'ready' }
    ]);
    expect(groups.map((group) => group.map((item) => item.id))).toEqual([['movie-1'], ['season-1', 'season-2']]);
  });

  it('herstelt genegeerde titel met vorige status en reden', () => {
    const state: AppState = {
      suggestions: [{ ...suggestion, status: 'dismissed', reason: 'Handmatig genegeerd', statusBeforeDismiss: 'ready', reasonBeforeDismiss: '100% bekeken' }],
      ignoredSuggestionIds: [suggestion.id],
      activity: []
    };
    const restored = testing.restoreIgnoredSuggestion(state, suggestion.id);
    expect(restored?.status).toBe('ready');
    expect(restored?.reason).toBe('100% bekeken');
    expect(state.ignoredSuggestionIds).toEqual([]);
  });

  it('verbergt alle seizoenen die bij verwijderd Seerr-verzoek horen', () => {
    const state: AppState = {
      suggestions: [
        { ...suggestion, id: 'season-1', requestId: 44, mediaKind: 'season', subtitle: 'Seizoen 1' },
        { ...suggestion, id: 'season-2', requestId: 44, mediaKind: 'season', subtitle: 'Seizoen 2' },
        { ...suggestion, id: 'other', requestId: 45 }
      ],
      ignoredSuggestionIds: [],
      activity: []
    };
    expect(testing.markRequestRemoved(state, 44)).toBe(2);
    expect(state.suggestions.filter((item) => item.requestId === 44).every((item) => item.status === 'removed')).toBe(true);
    expect(state.suggestions.find((item) => item.requestId === 45)?.status).toBe('waiting');
  });
});
