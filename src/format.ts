import { localizeGenre } from '../genres';
import type { Language, ServiceName, Suggestion, SuggestionStatus } from '../shared';
import radarrLogo from './assets/radarr.png';
import seerrLogo from './assets/seerr.png';
import sonarrLogo from './assets/sonarr.png';
import tautulliLogo from './assets/tautulli.png';
import { t } from './i18n';
import type { TranslationKey } from './translations';

export const services: Record<ServiceName, { label: string; roleKey: TranslationKey; logo: string }> = {
  seerr: { label: 'Seerr', roleKey: 'requests', logo: seerrLogo },
  tautulli: { label: 'Tautulli', roleKey: 'watchHistory', logo: tautulliLogo },
  radarr: { label: 'Radarr', roleKey: 'movies', logo: radarrLogo },
  sonarr: { label: 'Sonarr', roleKey: 'series', logo: sonarrLogo }
};

export const serviceNames = Object.keys(services) as ServiceName[];

export const SIGNED_OUT_EVENT = 'watchsweeperr:signed-out';

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  // An expired session anywhere in the app sends the user back to the sign-in screen.
  if (response.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
  return body as T;
}

const locale = (language: Language) => (language === 'en' ? 'en-GB' : 'nl-NL');

export function formatDateTime(value: string | undefined, language: Language): string {
  return value
    ? new Intl.DateTimeFormat(locale(language), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
    : t(language, 'never');
}

export function formatDate(value: string | undefined, language: Language): string {
  return value
    ? new Intl.DateTimeFormat(locale(language), { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
    : t(language, 'unknown');
}

export function formatRelative(value: string | undefined, language: Language): string {
  if (!value) return t(language, 'neverScanned');
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return t(language, 'justNow');
  if (minutes < 60) return t(language, 'minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? t(language, 'hoursAgo', { count: hours }) : t(language, 'daysAgo', { count: Math.floor(hours / 24) });
}

export function formatBytes(value: number | undefined, language: Language): string {
  if (value === undefined) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale(language), { maximumFractionDigits: unit >= 4 ? 1 : 0 }).format(size)} ${units[unit]}`;
}

export function formatNumber(value: number | undefined, language: Language): string {
  return value === undefined ? '—' : new Intl.NumberFormat(locale(language)).format(value);
}

const statusKeys: Record<SuggestionStatus, TranslationKey> = {
  ready: 'readyForReview',
  partial: 'beingWatched',
  waiting: 'notWatched',
  removed: 'removed',
  dismissed: 'ignored'
};

export function statusLabel(status: SuggestionStatus, language: Language): string {
  return t(language, statusKeys[status]);
}

export function suggestionGenres(suggestion: Suggestion, language: Language): string[] {
  return (suggestion.genres ?? []).map((genre, index) => localizeGenre(genre, language, suggestion.genreIds?.[index]));
}
