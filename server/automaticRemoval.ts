import type { AppSettings, AppState, AutomaticRemovalRule, Suggestion } from '../shared.js';
import { deleteSeerrRequest as deleteRequest, removeMedia as remove, removeSeasonGroup as removeSeasons } from './apiClients.js';
import { activity } from './stateStore.js';

interface RemovalDependencies {
  removeMedia: typeof remove;
  removeSeasonGroup: typeof removeSeasons;
  deleteSeerrRequest: typeof deleteRequest;
}

export interface AutomaticRemovalCandidate {
  requestId: number;
  requestIds: number[];
  rule: AutomaticRemovalRule;
  suggestions: Suggestion[];
}

const defaultDependencies: RemovalDependencies = {
  removeMedia: remove,
  removeSeasonGroup: removeSeasons,
  deleteSeerrRequest: deleteRequest
};

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

    const requestIds = first.requestIds?.length ? first.requestIds : [requestId];
    if (first.mediaKind === 'movie') {
      const movie = group.find((item) => item.mediaKind === 'movie');
      if (rule.movies && movie && isEligible(movie, rule, now)) result.push({ requestId, requestIds, rule, suggestions: [movie] });
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
    if (complete) result.push({ requestId, requestIds, rule, suggestions: [...requested].map((seasonNumber) => available.get(seasonNumber)!)});
  }
  return result;
}

export async function runAutomaticRemovals(
  settings: AppSettings,
  state: AppState,
  dependencies: RemovalDependencies = defaultDependencies,
  now = new Date()
): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;

  for (const candidate of automaticRemovalCandidates(state.suggestions, settings, now)) {
    const suggestion = candidate.suggestions[0];
    try {
      const mediaDetail = suggestion.mediaKind === 'movie'
        ? await dependencies.removeMedia(settings, suggestion)
        : await dependencies.removeSeasonGroup(settings, candidate.suggestions);
      const requestDetail = (await Promise.all(candidate.requestIds.map((requestId) => dependencies.deleteSeerrRequest(settings.services.seerr, requestId)))).join(' ');
      markRequestRemoved(state, candidate.requestIds);
      state.activity.unshift(activity(
        'remove',
        `${suggestion.title} automatisch verwijderd`,
        `${mediaDetail} ${requestDetail} Volledig bekeken na aanvraag door ${suggestion.requester}; wachttijd ${candidate.rule.delayDays} dagen.`
      ));
      removed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 180) : 'Onbekende fout';
      state.activity.unshift(activity(
        'remove',
        `Automatisch verwijderen mislukt: ${suggestion.title}`,
        `${message}. Nieuwe poging bij volgende scan.`,
        'error'
      ));
      failed += 1;
    }
  }

  return { removed, failed };
}
