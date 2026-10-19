import { describe, expect, it } from 'vitest';
import { SCHEDULED_SYNC_INTERVAL_MS, shouldRunScheduledSync } from './scheduler.js';

const settings = {
  demoMode: false,
  automaticRemovalRules: []
};

describe('periodieke scan', () => {
  it('scant live ieder uur, ook zonder automatische verwijderregels', () => {
    expect(SCHEDULED_SYNC_INTERVAL_MS).toBe(60 * 60 * 1000);
    expect(shouldRunScheduledSync(settings)).toBe(true);
  });

  it('roept externe services niet aan in demomodus', () => {
    expect(shouldRunScheduledSync({ ...settings, demoMode: true })).toBe(false);
  });
});
