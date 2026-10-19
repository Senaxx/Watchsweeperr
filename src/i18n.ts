import type { Language } from '../shared';
import { translations, type TranslationKey } from './translations';

export type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

export function t(language: Language, key: TranslationKey, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), translations[language][key]);
}

export function translator(language: Language): Translate {
  return (key, values) => t(language, key, values);
}

const exactServerText: Record<string, string> = {
  Film: 'Movie',
  'Nog niet bekeken': 'Not watched',
  'Handmatig genegeerd': 'Manually ignored',
  'Opnieuw te controleren': 'Ready to check again',
  'Aantal afleveringen onbekend': 'Episode count unknown',
  'Media en Seerr-verzoek verwijderd': 'Media and Seerr request removed',
  'Instellingen opgeslagen': 'Settings saved',
  'Demomodus staat aan.': 'Demo mode is active.',
  'Live integraties staan aan.': 'Live integrations are active.',
  'Demoscan voltooid': 'Demo scan completed',
  'Scan voltooid': 'Scan completed',
  'Seerr-verzoek verwijderd.': 'Seerr request removed.',
  'Seerr-verzoek was al verwijderd.': 'Seerr request was already removed.',
  'Film was al verwijderd uit Radarr.': 'Movie was already removed from Radarr.',
  'Serie was al verwijderd uit Sonarr.': 'Series was already removed from Sonarr.',
  'Ongeldige of gemengde seizoenselectie.': 'Invalid or mixed season selection.',
  'Voorstel niet gevonden.': 'Suggestion not found.',
  'Alleen volledig bekeken content kan worden verwijderd.': 'Only fully watched content can be removed.',
  'Bevestiging ontbreekt.': 'Confirmation is missing.',
  'Verwijderen mislukt': 'Removal failed',
  'Inloggen vereist.': 'Sign-in required.',
  'Onjuiste gebruikersnaam of wachtwoord.': 'Incorrect username or password.',
  'Huidig wachtwoord klopt niet.': 'Current password is incorrect.',
  'Er bestaat al een account.': 'An account already exists.',
  'Gebruikersnaam is verplicht.': 'Username is required.',
  'Wachtwoord moet minstens 8 tekens hebben.': 'Password must be at least 8 characters.'
};

const serviceActions: Record<string, string> = {
  'verbinding testen': 'test the connection',
  'status lezen': 'read status',
  'verzoeken lezen': 'read requests',
  'mediagegevens lezen': 'read media details',
  'kijkgeschiedenis lezen': 'read watch history',
  'Plex-metadata lezen': 'read Plex metadata',
  'films lezen': 'read movies',
  'series lezen': 'read series',
  'verzoek verwijderen': 'remove the request',
  'films lezen voor verwijdering': 'read movies before removal',
  'film en bestanden verwijderen': 'remove the movie and files',
  'series lezen voor verwijdering': 'read series before removal',
  'serie en bestanden verwijderen': 'remove the series and files',
  'afleveringsbestand verwijderen': 'remove the episode file',
  'seizoen deactiveren': 'disable the season'
};

const plural = (count: string, one: string, many: string) => `${count} ${Number(count) === 1 ? one : many}`;

// Texts from the server and its stored state are Dutch; this translates the known ones for the English interface.
const patterns: [RegExp, string | ((...groups: string[]) => string)][] = [
  [/^Seizoen (\d+)$/, 'Season $1'],
  [/^(\d+)% bekeken door aanvrager$/, '$1% watched by requester'],
  [/^(\d+)% bekeken$/, '$1% watched'],
  [/^(\d+) van (\d+) afleveringen bekeken$/, '$1 of $2 episodes watched'],
  [/^Langer dan (\d+) maand(?:en)? en (\d+) dag(?:en)? beschikbaar$/, (_, months, days) => `Available for more than ${plural(months, 'month', 'months')} and ${plural(days, 'day', 'days')}`],
  [/^Langer dan (\d+) maand(?:en)? beschikbaar$/, (_, months) => `Available for more than ${plural(months, 'month', 'months')}`],
  [/^Langer dan (\d+) dag(?:en)? beschikbaar$/, (_, days) => `Available for more than ${plural(days, 'day', 'days')}`],
  [/^Demo: geen externe bestanden of verzoeken gewijzigd\.$/, 'Demo: no external files or requests changed.'],
  [/ (\d+) Seerr-detailaanvragen overgeslagen; overige verzoeken zijn verwerkt\./, ' $1 Seerr media detail requests skipped; remaining requests were processed.'],
  [/ Automatisch: (\d+) verwijderd, (\d+) mislukt\./, ' Automatic: $1 removed, $2 failed.'],
  [/^(\d+) verzoeken en seizoenen gecontroleerd\./, '$1 requests and seasons checked.'],
  [/^Configureer services om echte verzoeken te controleren\.$/, 'Configure services to check actual requests.'],
  [/^Demogegevens geladen$/, 'Demo data loaded'],
  [/^(.+) genegeerd$/, '$1 ignored'],
  [/^(.+) hersteld$/, '$1 restored'],
  [/^(.+) automatisch verwijderd$/, '$1 automatically removed'],
  [/^Automatisch verwijderen mislukt: (.+)$/, 'Automatic removal failed: $1'],
  [/^(\d+) verwijderd, mislukt: /, '$1 removed, failed: '],
  [/^(.+) verwijderd$/, '$1 removed'],
  [/^Item blijft verborgen na nieuwe scans\.$/, 'Item stays hidden after new scans.'],
  [/^Titel verschijnt weer in het overzicht\.$/, 'Title appears in the overview again.'],
  [/Film, volledige map en Radarr-item verwijderd \(id (\d+)\)\./g, 'Movie, complete folder and Radarr item removed (id $1).'],
  [/Alle resterende seizoenen, volledige seriemap en Sonarr-item verwijderd \(id (\d+)\)\./g, 'All remaining seasons, complete series folder and Sonarr item removed (id $1).'],
  [/(\d+) seizoenbestanden verwijderd en seizoen gedemonitord in Sonarr\./g, '$1 season files removed and season unmonitored in Sonarr.'],
  [/(\d+) bestanden uit (\d+) seizoenen verwijderd en gedemonitord in Sonarr\./g, '$1 files from $2 seasons removed and unmonitored in Sonarr.'],
  [/Seerr-verzoek verwijderd\./g, 'Seerr request removed.'],
  [/Seerr-verzoek was al verwijderd\./g, 'Seerr request was already removed.'],
  [/Volledig bekeken na aanvraag door (.+); wachttijd (\d+) dagen\./, 'Fully watched after being requested by $1; delay $2 days.'],
  [/Nieuwe poging bij volgende scan\./, 'New attempt during the next scan.'],
  [/^URL en API-key zijn verplicht\.$/, 'URL and API key are required.'],
  [/^API-key ontbreekt voor: (.+)\.$/, 'API key missing for: $1.'],
  [/^Vul de API-key opnieuw in voor (.+): de URL is gewijzigd\.$/, 'Enter the API key again for $1: the URL has changed.']
];

function translateServiceError(text: string): string | undefined {
  const match = text.match(/^(Seerr|Tautulli|Radarr|Sonarr): (.+?) mislukt(?: \((\d+)\))?\.(.*)$/s);
  if (!match) return undefined;
  const [, service, action, status, rest] = match;
  const seasonRead = action.match(/^afleveringen van seizoen (\d+) lezen$/);
  const englishAction = serviceActions[action] ?? (seasonRead ? `read episodes from season ${seasonRead[1]}` : action);
  const detail = rest
    .replace(' Controleer de API-key.', ' Check the API key.')
    .replace(' Controleer of de API-key toegang tot deze functie heeft.', ' Check whether the API key has access to this function.')
    .replace(' Controleer de basis-URL.', ' Check the base URL.')
    .replace(' Antwoord:', ' Response:');
  return `${service}: failed to ${englishAction}${status ? ` (${status})` : ''}.${detail}`;
}

export function serverText(text: string | undefined, language: Language): string {
  if (language === 'nl' || !text) return text ?? '';
  if (exactServerText[text]) return exactServerText[text];
  const serviceError = translateServiceError(text);
  if (serviceError) return serviceError;
  return patterns.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement as string), text);
}
