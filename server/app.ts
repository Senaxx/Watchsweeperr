import express from 'express';
import { z } from 'zod';
import type { AppState, HiddenCounts, ServiceConfig, ServiceName, Suggestion } from '../shared.js';
import { genreKey } from '../genres.js';
import { authRoutes, requireSession } from './auth.js';
import { deleteSeerrRequest, removeMedia, removeSeasonGroup, ServiceApiError, testService } from './apiClients.js';
import { markRequestRemoved, runAutomaticRemovals } from './automaticRemoval.js';
import { cleanUrl, getSettings, saveSettings, toPublicSettings } from './settingsStore.js';
import { activity, getState, updateState } from './stateStore.js';
import { retentionExpired, scanRequests } from './syncEngine.js';

const serviceNames = ['seerr', 'tautulli', 'radarr', 'sonarr'] as const;
const serviceSchema = z.object({ url: z.union([z.literal(''), z.string().url()]), apiKey: z.string().optional().default('') });
const settingsSchema = z.object({
  language: z.enum(['nl', 'en']).default('nl'),
  demoMode: z.boolean(),
  watchThreshold: z.number().int().min(50).max(100),
  retentionMonths: z.number().int().min(0).max(36),
  retentionDays: z.number().int().min(0).max(1095).optional(),
  excludedUsers: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  ignoredGenres: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  automaticRemovalRules: z.array(z.object({
    requester: z.string().trim().min(1).max(80),
    movies: z.boolean(),
    series: z.boolean(),
    delayDays: z.number().int().min(0).max(365)
  }).refine((rule) => rule.movies || rule.series, { message: 'Selecteer films en/of series.' })).max(100).default([]),
  services: z.object({
    seerr: serviceSchema,
    tautulli: serviceSchema,
    radarr: serviceSchema,
    sonarr: serviceSchema
  })
});

function applyIgnoredSuggestions(suggestions: Suggestion[], ignoredIds: string[]) {
  const ignored = new Set(ignoredIds);
  return suggestions.map((suggestion) => ignored.has(suggestion.id)
    ? {
        ...suggestion,
        statusBeforeDismiss: suggestion.status as 'ready' | 'partial' | 'waiting',
        reasonBeforeDismiss: suggestion.reason,
        status: 'dismissed' as const,
        reason: 'Handmatig genegeerd'
      }
    : suggestion);
}

function filterExcludedSuggestions(suggestions: Suggestion[], excludedUsers: string[]) {
  const excluded = new Set(excludedUsers.map((user) => user.trim().toLocaleLowerCase('nl-NL')));
  return suggestions.filter((suggestion) => !excluded.has(suggestion.requester.trim().toLocaleLowerCase('nl-NL')));
}

function filterIgnoredGenres(suggestions: Suggestion[], ignoredGenres: string[]) {
  const ignored = new Set(ignoredGenres.map((genre) => genreKey(genre)));
  return suggestions.filter((suggestion) => !suggestion.genres?.some((genre, index) => ignored.has(genreKey(genre, suggestion.genreIds?.[index]))));
}

function filterRecentRequests(suggestions: Suggestion[], months: number, days: number, now = new Date()) {
  return suggestions.filter((suggestion) => suggestion.status === 'ready' || retentionExpired(suggestion.availableSince ?? suggestion.requestedAt, months, now, days));
}

// Why open requests are missing from the overview, so the page can say so instead of looking incomplete.
function hiddenCounts(suggestions: Suggestion[], settings: Awaited<ReturnType<typeof getSettings>>): HiddenCounts {
  const open = suggestions.filter(canManuallyRemove);
  const afterExcluded = filterExcludedSuggestions(open, settings.excludedUsers);
  const afterGenres = filterIgnoredGenres(afterExcluded, settings.ignoredGenres);
  const shown = settings.demoMode ? afterGenres : filterRecentRequests(afterGenres, settings.retentionMonths, settings.retentionDays);
  return {
    excludedUsers: open.length - afterExcluded.length,
    ignoredGenres: afterExcluded.length - afterGenres.length,
    notYetDue: afterGenres.length - shown.length
  };
}

function canManuallyRemove(suggestion: Suggestion): boolean {
  return suggestion.status === 'ready' || suggestion.status === 'waiting' || suggestion.status === 'partial';
}

function groupSuggestionsForRemoval(suggestions: Suggestion[]): Suggestion[][] {
  const groups = new Map<string, Suggestion[]>();
  for (const suggestion of suggestions) {
    const key = suggestion.mediaKind === 'movie'
      ? `movie:${suggestion.id}`
      : `series:${suggestion.tvdbId ?? suggestion.requestId}`;
    const group = groups.get(key) ?? [];
    group.push(suggestion);
    groups.set(key, group);
  }
  return [...groups.values()];
}

interface RemovalResult {
  details: string[];
  failures: string[];
  removedCount: number;
}

// Removes title by title; one failure does not stop the others, and every success is recorded.
async function removeSuggestions(settings: Awaited<ReturnType<typeof getSettings>>, state: AppState, suggestions: Suggestion[]): Promise<RemovalResult> {
  const result: RemovalResult = { details: [], failures: [], removedCount: 0 };
  for (const group of groupSuggestionsForRemoval(suggestions)) {
    const requestIds = [...new Set(group.flatMap((suggestion) => suggestion.requestIds?.length ? suggestion.requestIds : [suggestion.requestId]))];
    try {
      if (!settings.demoMode) {
        const mediaDetail = group[0].mediaKind === 'movie'
          ? await removeMedia(settings, group[0])
          : await removeSeasonGroup(settings, group);
        const requestDetails = await Promise.all(requestIds.map((requestId) => deleteSeerrRequest(settings.services.seerr, requestId)));
        result.details.push(mediaDetail, ...requestDetails);
      }
      markRequestRemoved(state, requestIds);
      result.removedCount += group.length;
    } catch (error) {
      result.failures.push(`${group[0].title}: ${error instanceof Error ? error.message : 'Onbekende fout'}`);
    }
  }
  if (settings.demoMode) result.details.push('Demo: geen externe bestanden of verzoeken gewijzigd.');
  return result;
}

function logRemoval(state: AppState, title: string, result: RemovalResult) {
  if (result.removedCount) state.activity.unshift(activity('remove', title, result.details.join(' ')));
  if (result.failures.length) state.activity.unshift(activity('remove', 'Verwijderen mislukt', result.failures.join(' '), 'error'));
}

// A stored API key may only be sent to the URL it was saved for.
function keyForUrl(url: string | undefined, apiKey: string | undefined, current: ServiceConfig): string {
  if (apiKey?.trim()) return apiKey.trim();
  return !url || cleanUrl(url) === current.url ? current.apiKey : '';
}

interface RouteOutcome {
  status: number;
  body: unknown;
}

function restoreIgnoredSuggestion(state: AppState, id: string) {
  const suggestion = state.suggestions.find((item) => item.id === id);
  if (!suggestion || !state.ignoredSuggestionIds.includes(id)) return undefined;
  state.ignoredSuggestionIds = state.ignoredSuggestionIds.filter((ignoredId) => ignoredId !== id);
  suggestion.status = suggestion.statusBeforeDismiss ?? 'waiting';
  suggestion.reason = suggestion.reasonBeforeDismiss ?? 'Opnieuw te controleren';
  delete suggestion.statusBeforeDismiss;
  delete suggestion.reasonBeforeDismiss;
  return suggestion;
}

let synchronization: Promise<AppState> | undefined;

async function performSync(): Promise<AppState> {
  const settings = await getSettings();
  if (settings.demoMode) {
    return updateState((state) => {
      state.lastSyncAt = new Date().toISOString();
      state.activity.unshift(activity('sync', 'Demoscan voltooid', `${state.suggestions.length} demo-items gecontroleerd.`));
      return state;
    });
  }
  const missing = Object.entries(settings.services).filter(([, service]) => !service.apiKey).map(([name]) => name);
  if (missing.length) throw new Error(`API-key ontbreekt voor: ${missing.join(', ')}.`);
  // The slow scan runs outside the state queue; only applying its result waits for other changes.
  const scan = await scanRequests(settings);
  return updateState(async (state) => {
    state.suggestions = applyIgnoredSuggestions(scan.suggestions, state.ignoredSuggestionIds);
    state.serverStatistics = scan.serverStatistics;
    const automatic = await runAutomaticRemovals(settings, state);
    state.lastSyncAt = new Date().toISOString();
    const automaticDetail = automatic.removed || automatic.failed
      ? ` Automatisch: ${automatic.removed} verwijderd, ${automatic.failed} mislukt.`
      : '';
    const warningDetail = scan.warnings.length
      ? ` ${scan.warnings.length} Seerr-detailaanvragen overgeslagen; overige verzoeken zijn verwerkt.`
      : '';
    state.activity.unshift(activity(
      'sync',
      'Scan voltooid',
      `${state.suggestions.length} verzoeken en seizoenen gecontroleerd.${warningDetail}${automaticDetail}`,
      scan.warnings.length ? 'info' : 'success'
    ));
    return state;
  });
}

export function synchronize() {
  if (!synchronization) {
    synchronization = performSync().finally(() => { synchronization = undefined; });
  }
  return synchronization;
}

// The hourly scan. Failures go to the activity log so they show up in the app, not only in the Docker log.
export async function scheduledSync() {
  try {
    const settings = await getSettings();
    if (!settings.demoMode) await synchronize();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout';
    console.error('Periodieke WatchSweeperr-scan mislukt:', message);
    await updateState((state) => { state.activity.unshift(activity('sync', 'Scan mislukt', message, 'error')); }).catch(() => undefined);
  }
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));
  app.use(requireSession);
  app.use(authRoutes());

  app.get('/api/health', (_request, response) => response.json({ ok: true }));

  app.get('/api/overview', async (_request, response, next) => {
    try {
      const [state, settings] = await Promise.all([getState(), getSettings()]);
      const servicesConfigured = Object.values(settings.services).filter((service) => service.apiKey).length;
      const ignoredSuggestions = state.suggestions.filter((suggestion) => suggestion.status === 'dismissed');
      const eligible = settings.demoMode ? state.suggestions : filterRecentRequests(state.suggestions, settings.retentionMonths, settings.retentionDays);
      const suggestions = filterIgnoredGenres(filterExcludedSuggestions(eligible, settings.excludedUsers), settings.ignoredGenres);
      response.json({ ...state, suggestions, ignoredSuggestions, hidden: hiddenCounts(state.suggestions, settings), demoMode: settings.demoMode, servicesConfigured });
    } catch (error) { next(error); }
  });

  app.get('/api/settings', async (_request, response, next) => {
    try { response.json(toPublicSettings(await getSettings())); } catch (error) { next(error); }
  });

  app.put('/api/settings', async (request, response, next) => {
    try {
      const input = settingsSchema.parse(request.body);
      const current = await getSettings();
      const needsKey = serviceNames.filter((name) => current.services[name].apiKey
        && !keyForUrl(input.services[name].url, input.services[name].apiKey, current.services[name]));
      if (needsKey.length) return response.status(400).json({ error: `Vul de API-key opnieuw in voor ${needsKey.join(', ')}: de URL is gewijzigd.` });
      const settings = await saveSettings(input);
      await updateState((state) => {
        state.activity.unshift(activity('settings', 'Instellingen opgeslagen', settings.demoMode ? 'Demomodus staat aan.' : 'Live integraties staan aan.', 'info'));
      });
      response.json(toPublicSettings(settings));
    } catch (error) { next(error); }
  });

  app.post('/api/services/:name/test', async (request, response, next) => {
    try {
      const name = z.enum(serviceNames).parse(request.params.name) as ServiceName;
      const current = await getSettings();
      const supplied = serviceSchema.partial().parse(request.body);
      const service = {
        url: supplied.url || current.services[name].url,
        apiKey: keyForUrl(supplied.url, supplied.apiKey, current.services[name])
      };
      const version = await testService(name, service);
      response.json({ ok: true, version });
    } catch (error) { next(error); }
  });

  app.post('/api/sync', async (_request, response, next) => {
    try {
      response.json(await synchronize());
    } catch (error) { next(error); }
  });

  app.post('/api/suggestions/:id/remove', async (request, response, next) => {
    try {
      z.object({ confirmation: z.literal(true) }).parse(request.body);
      const settings = await getSettings();
      const outcome = await updateState<RouteOutcome>(async (state) => {
        const suggestion = state.suggestions.find((item) => item.id === request.params.id);
        if (!suggestion) return { status: 404, body: { error: 'Voorstel niet gevonden.' } };
        if (!canManuallyRemove(suggestion)) return { status: 409, body: { error: 'Deze content kan niet handmatig worden verwijderd.' } };
        const result = await removeSuggestions(settings, state, [suggestion]);
        logRemoval(state, `${suggestion.title} verwijderd`, result);
        return result.failures.length
          ? { status: 502, body: { error: result.failures.join(' ') } }
          : { status: 200, body: { suggestion, detail: result.details.join(' ') } };
      });
      response.status(outcome.status).json(outcome.body);
    } catch (error) { next(error); }
  });

  app.post('/api/suggestions/bulk-remove', async (request, response, next) => {
    try {
      const input = z.object({ ids: z.array(z.string().min(1)).min(1).max(100), confirmation: z.literal(true) }).parse(request.body);
      const ids = [...new Set(input.ids)];
      const settings = await getSettings();
      const outcome = await updateState<RouteOutcome>(async (state) => {
        const suggestions = ids.map((id) => state.suggestions.find((item) => item.id === id));
        if (suggestions.some((suggestion) => !suggestion)) return { status: 404, body: { error: 'Een of meer voorstellen zijn niet gevonden.' } };
        const selected = suggestions as Suggestion[];
        if (!selected.every(canManuallyRemove)) return { status: 409, body: { error: 'Deze content kan niet handmatig worden verwijderd.' } };
        const result = await removeSuggestions(settings, state, selected);
        logRemoval(state, `${result.removedCount} items verwijderd`, result);
        return result.failures.length
          ? { status: 502, body: { error: `${result.removedCount} verwijderd, mislukt: ${result.failures.join(' ')}`, removed: result.removedCount } }
          : { status: 200, body: { removed: result.removedCount, detail: result.details.join(' ') } };
      });
      response.status(outcome.status).json(outcome.body);
    } catch (error) { next(error); }
  });

  app.post('/api/suggestions/:id/dismiss', async (request, response, next) => {
    try {
      const outcome = await updateState<RouteOutcome>((state) => {
        const suggestion = state.suggestions.find((item) => item.id === request.params.id);
        if (!suggestion) return { status: 404, body: { error: 'Voorstel niet gevonden.' } };
        if (['ready', 'partial', 'waiting'].includes(suggestion.status)) {
          suggestion.statusBeforeDismiss = suggestion.status as 'ready' | 'partial' | 'waiting';
          suggestion.reasonBeforeDismiss = suggestion.reason;
        }
        suggestion.status = 'dismissed';
        suggestion.reason = 'Handmatig genegeerd';
        if (!state.ignoredSuggestionIds.includes(suggestion.id)) state.ignoredSuggestionIds.push(suggestion.id);
        state.activity.unshift(activity('dismiss', `${suggestion.title} genegeerd`, 'Item blijft verborgen na nieuwe scans.', 'info'));
        return { status: 200, body: suggestion };
      });
      response.status(outcome.status).json(outcome.body);
    } catch (error) { next(error); }
  });

  app.post('/api/suggestions/:id/restore', async (request, response, next) => {
    try {
      const outcome = await updateState<RouteOutcome>((state) => {
        const suggestion = restoreIgnoredSuggestion(state, request.params.id);
        if (!suggestion) return { status: 404, body: { error: 'Genegeerd voorstel niet gevonden.' } };
        state.activity.unshift(activity('settings', `${suggestion.title} hersteld`, 'Titel verschijnt weer in het overzicht.', 'info'));
        return { status: 200, body: suggestion };
      });
      response.status(outcome.status).json(outcome.body);
    } catch (error) { next(error); }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join(', ') : error instanceof Error ? error.message : 'Onbekende fout';
    response.status(error instanceof z.ZodError ? 400 : error instanceof ServiceApiError ? 502 : 500).json({ error: message });
  });

  return app;
}

export const testing = { hiddenCounts, applyIgnoredSuggestions, filterExcludedSuggestions, filterIgnoredGenres, filterRecentRequests, canManuallyRemove, groupSuggestionsForRemoval, restoreIgnoredSuggestion, markRequestRemoved };
