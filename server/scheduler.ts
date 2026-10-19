import type { AppSettings } from '../shared.js';

export const SCHEDULED_SYNC_INTERVAL_MS = 60 * 60 * 1000;

export function shouldRunScheduledSync(settings: Pick<AppSettings, 'demoMode'>): boolean {
  return !settings.demoMode;
}
