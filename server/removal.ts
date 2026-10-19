import type { AppSettings, AppState, AutomaticRemovalRule, Suggestion } from '../shared.js';
import { deleteSeerrRequest, removeMedia, removeSeasonGroup } from './apiClients.js';
import { activity } from './stateStore.js';

export interface AutomaticRemovalCandidate {
  requestId: number;
  rule: AutomaticRemovalRule;
  suggestions: Suggestion[];
}

export interface RemovalResult {
  details: string[];
  failures: string[];
  removedCount: number;
}

// Ignored titles keep their real status in the state; everything that shows or removes them sees them as ignored.
export function withIgnored(state: AppState): Suggestion[] {
  const ignored = new Set(state.ignoredSuggestionIds);
  return state.suggestions.map((suggestion) => ignored.has(suggestion.id) ? { ...suggestion, status: 'dismissed' as const, reason: 'Handmatig genegeerd' } : suggestion);
}

function normalizedUser(value: string): string {
  return value.trim().toLocaleLowerCase('nl-NL');
}

export function markRequestRemoved(state: AppState, requestIdOrIds: number | number[]): number {
  const requestIds = new Set(Array.isArray(requestIdOrIds) ? requestIdOrIds : [requestIdOrIds]);
  const affected = state.suggestions.filter((item) => requestIds.has(item.requestId) || item.requestIds?.some((requestId) => requestIds.has(requestId)));
  for (const suggestion of affected) {
    suggestion.status = 'removed';
    suggestion.reason = 'Media en Seerr-verzoek verwijderd';
  }
  return affected.length;
}

function isEligible(suggestion: Suggestion, rule: AutomaticRemovalRule, now: Date): boolean {
  const completedAt = suggestion.watchedAfterRequestAt ? new Date(suggestion.watchedAfterRequestAt) : undefined;
  if (!completedAt || Number.isNaN(completedAt.valueOf())) return false;
  const eligibleAt = new Date(completedAt);
  eligibleAt.setUTCDate(eligibleAt.getUTCDate() + rule.delayDays);
  return suggestion.status === 'ready'
    && suggestion.suggestionBasis === 'watched'
    && suggestion.matchConfidence === 'high'
    && suggestion.matchMethod === 'external-id'
    && eligibleAt <= now;
}

export function automaticRemovalCandidates(
  suggestions: Suggestion[],
  settings: AppSettings,
  now = new Date()
): AutomaticRemovalCandidate[] {
  if (settings.demoMode) return [];
  const rules = new Map(settings.automaticRemovalRules.map((rule) => [normalizedUser(rule.requester), rule]));
  const excluded = new Set(settings.excludedUsers.map(normalizedUser));
  const byRequest = new Map<number, Suggestion[]>();
  for (const suggestion of suggestions) {
    const group = byRequest.get(suggestion.requestId) ?? [];
    group.push(suggestion);
    byRequest.set(suggestion.requestId, group);
  }

  const result: AutomaticRemovalCandidate[] = [];
  for (const [requestId, group] of byRequest) {
    const first = group[0];
    const requester = normalizedUser(first.requester);
    const rule = rules.get(requester);
    if (!rule || excluded.has(requester)) continue;

    if (first.mediaKind === 'movie') {
      const movie = group.find((item) => item.mediaKind === 'movie');
      if (rule.movies && movie && isEligible(movie, rule, now)) result.push({ requestId, rule, suggestions: [movie] });
      continue;
    }

    if (!rule.series) continue;
    const seasons = group.filter((item) => item.mediaKind === 'season');
    const requested = new Set(seasons.flatMap((item) => item.requestedSeasonNumbers ?? (item.seasonNumber ? [item.seasonNumber] : [])));
    const available = new Map(seasons.map((item) => [item.seasonNumber, item]));
    const complete = requested.size > 0 && [...requested].every((seasonNumber) => {
      const suggestion = available.get(seasonNumber);
      return Boolean(suggestion && isEligible(suggestion, rule, now));
    });
    if (complete) result.push({ requestId, rule, suggestions: [...requested].map((seasonNumber) => available.get(seasonNumber)!)});
  }
  return result;
}

export function groupSuggestionsForRemoval(suggestions: Suggestion[]): Suggestion[][] {
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

// Removes title by title, for manual and automatic removal alike; one failure does not stop the others,
// and every success is recorded.
export async function removeSuggestions(settings: AppSettings, state: AppState, suggestions: Suggestion[]): Promise<RemovalResult> {
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

export async function runAutomaticRemovals(settings: AppSettings, state: AppState, now = new Date()): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  for (const candidate of automaticRemovalCandidates(withIgnored(state), settings, now)) {
    const { title, requester } = candidate.suggestions[0];
    const result = await removeSuggestions(settings, state, candidate.suggestions);
    if (result.failures.length) {
      state.activity.unshift(activity('remove', `Automatisch verwijderen mislukt: ${title}`, `${result.failures.join(' ').slice(0, 180)}. Nieuwe poging bij volgende scan.`, 'error'));
      failed += 1;
    } else {
      state.activity.unshift(activity('remove', `${title} automatisch verwijderd`, `${result.details.join(' ')} Volledig bekeken na aanvraag door ${requester}; wachttijd ${candidate.rule.delayDays} dagen.`));
      removed += 1;
    }
  }
  return { removed, failed };
}
