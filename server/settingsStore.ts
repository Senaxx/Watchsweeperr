import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppSettings, AutomaticRemovalRule, PublicSettings, ServiceName } from '../shared.js';

const dataDirectory = process.env.WATCHSWEEPERR_DATA_DIR ?? path.join(process.cwd(), 'data');
const settingsPath = path.join(dataDirectory, 'settings.json');

const defaults: AppSettings = {
  language: 'nl',
  demoMode: true,
  watchThreshold: 90,
  retentionMonths: 3,
  retentionDays: 0,
  excludedUsers: [],
  ignoredGenres: [],
  automaticRemovalRules: [],
  services: {
    seerr: { url: '', apiKey: '' },
    tautulli: { url: '', apiKey: '' },
    radarr: { url: '', apiKey: '' },
    sonarr: { url: '', apiKey: '' }
  }
};

export function cleanUrl(value: string): string {
  return value.trim().replace(/\/(home)?\/?$/i, '');
}

function uniqueTrimmed(values: string[], locale: string): string[] {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = value.toLocaleLowerCase(locale);
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanAutomaticRemovalRules(source: AutomaticRemovalRule[] = []): AutomaticRemovalRule[] {
  const result: AutomaticRemovalRule[] = [];
  const seen = new Set<string>();
  for (const value of source) {
    const requester = String(value?.requester ?? '').trim();
    const key = requester.toLocaleLowerCase('nl-NL');
    const movies = value?.movies === true;
    const series = value?.series === true;
    if (!requester || seen.has(key) || (!movies && !series)) continue;
    seen.add(key);
    const rawDelay = Number(value?.delayDays ?? 0);
    result.push({
      requester,
      movies,
      series,
      delayDays: Math.min(365, Math.max(0, Number.isFinite(rawDelay) ? Math.round(rawDelay) : 0))
    });
  }
  return result;
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const saved = JSON.parse(await readFile(settingsPath, 'utf8')) as Partial<AppSettings>;
    return {
      ...defaults,
      ...saved,
      language: saved.language === 'en' ? 'en' : 'nl',
      excludedUsers: uniqueTrimmed(saved.excludedUsers ?? [], 'nl-NL'),
      ignoredGenres: uniqueTrimmed(saved.ignoredGenres ?? [], 'en-US'),
      automaticRemovalRules: cleanAutomaticRemovalRules(saved.automaticRemovalRules),
      services: {
        ...defaults.services,
        ...saved.services
      }
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(defaults);
    throw error;
  }
}

export async function saveSettings(input: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next: AppSettings = {
    language: input.language === 'en' ? 'en' : input.language === 'nl' ? 'nl' : current.language,
    demoMode: input.demoMode ?? current.demoMode,
    watchThreshold: input.watchThreshold ?? current.watchThreshold,
    retentionMonths: input.retentionMonths ?? current.retentionMonths,
    retentionDays: input.retentionDays ?? current.retentionDays,
    excludedUsers: uniqueTrimmed(input.excludedUsers ?? current.excludedUsers, 'nl-NL'),
    ignoredGenres: uniqueTrimmed(input.ignoredGenres ?? current.ignoredGenres, 'en-US'),
    automaticRemovalRules: cleanAutomaticRemovalRules(input.automaticRemovalRules ?? current.automaticRemovalRules),
    services: structuredClone(current.services)
  };

  for (const name of Object.keys(current.services) as ServiceName[]) {
    const candidate = input.services?.[name];
    if (!candidate) continue;
    next.services[name].url = cleanUrl(candidate.url || current.services[name].url);
    if (candidate.apiKey?.trim()) next.services[name].apiKey = candidate.apiKey.trim();
  }

  await mkdir(dataDirectory, { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function toPublicSettings(settings: AppSettings): PublicSettings {
  const services = Object.fromEntries(
    (Object.entries(settings.services) as [ServiceName, AppSettings['services'][ServiceName]][]).map(([name, service]) => [
      name,
      {
        url: service.url,
        configured: Boolean(service.apiKey),
        keyPreview: service.apiKey ? `••••${service.apiKey.slice(-4)}` : ''
      }
    ])
  ) as PublicSettings['services'];

  return {
    language: settings.language,
    demoMode: settings.demoMode,
    watchThreshold: settings.watchThreshold,
    retentionMonths: settings.retentionMonths,
    retentionDays: settings.retentionDays,
    excludedUsers: settings.excludedUsers,
    ignoredGenres: settings.ignoredGenres,
    automaticRemovalRules: settings.automaticRemovalRules,
    services
  };
}

// Write a temp file and rename it over the old one, so a crash never leaves half a file.
export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}
`, 'utf8');
  await rename(`${filePath}.tmp`, filePath);
}

export { dataDirectory };

export const testing = { cleanAutomaticRemovalRules };
