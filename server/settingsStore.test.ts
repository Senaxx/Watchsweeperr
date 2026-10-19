import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dataDirectory: string;

beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'watchsweeperr-settings-'));
  process.env.WATCHSWEEPERR_DATA_DIR = dataDirectory;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.WATCHSWEEPERR_DATA_DIR;
  await rm(dataDirectory, { recursive: true, force: true });
});

describe('schone installatie-instellingen', () => {
  it('bevat geen vooraf ingevulde service-URL’s', async () => {
    const { getSettings } = await import('./settingsStore.js');
    const settings = await getSettings();

    expect(Object.values(settings.services).map((service) => service.url)).toEqual(['', '', '', '']);
    expect(Object.values(settings.services).map((service) => service.apiKey)).toEqual(['', '', '', '']);
    expect(settings.language).toBe('nl');
  });

  it('behoudt een bestaande maandinstelling wanneer dagprecisie nog niet is opgeslagen', async () => {
    await writeFile(path.join(dataDirectory, 'settings.json'), JSON.stringify({ retentionMonths: 3 }));
    const { getSettings } = await import('./settingsStore.js');
    await expect(getSettings()).resolves.toMatchObject({ retentionMonths: 3, retentionDays: 0 });
  });

  it('kan lege service-URL’s opslaan zolang services nog niet zijn ingesteld', async () => {
    const { createApp } = await import('./app.js');
    const response = await request(createApp()).put('/api/settings').send({
      demoMode: true,
      watchThreshold: 90,
      retentionMonths: 3,
      excludedUsers: [],
      automaticRemovalRules: [],
      services: {
        seerr: { url: '', apiKey: '' },
        tautulli: { url: '', apiKey: '' },
        radarr: { url: '', apiKey: '' },
        sonarr: { url: '', apiKey: '' }
      }
    });

    expect(response.status).toBe(200);
    const services = response.body.services as Record<string, { url: string }>;
    expect(Object.values(services).map((service) => service.url)).toEqual(['', '', '', '']);
  });

  it('slaat de gekozen Engelse taal op', async () => {
    const { createApp } = await import('./app.js');
    const response = await request(createApp()).put('/api/settings').send({
      language: 'en',
      demoMode: true,
      watchThreshold: 90,
      retentionMonths: 3,
      excludedUsers: [],
      automaticRemovalRules: [],
      services: {
        seerr: { url: '', apiKey: '' },
        tautulli: { url: '', apiKey: '' },
        radarr: { url: '', apiKey: '' },
        sonarr: { url: '', apiKey: '' }
      }
    });

    expect(response.status).toBe(200);
    expect(response.body.language).toBe('en');
    const { getSettings } = await import('./settingsStore.js');
    await expect(getSettings()).resolves.toMatchObject({ language: 'en' });
  });

  it('bewaart de dagprecisie en verbergt recente live-aanvragen meteen in het overzicht', async () => {
    const { createApp } = await import('./app.js');
    const { saveSettings, getSettings } = await import('./settingsStore.js');
    const { saveState } = await import('./stateStore.js');
    await saveSettings({ demoMode: false, retentionMonths: 0, retentionDays: 10 });
    const now = Date.now();
    const base = {
      mediaKind: 'movie' as const, subtitle: 'Film', requester: 'Tester', progress: 0,
      watchedItems: 0, totalItems: 1, status: 'waiting' as const,
      reason: 'Nog niet bekeken', matchConfidence: 'high' as const
    };
    await saveState({
      suggestions: [
        { ...base, id: 'old', requestId: 1, title: 'Old', requestedAt: new Date(now - 11 * 86400000).toISOString() },
        { ...base, id: 'new', requestId: 2, title: 'New', requestedAt: new Date(now - 9 * 86400000).toISOString() }
      ],
      ignoredSuggestionIds: [],
      activity: []
    });

    const response = await request(createApp()).get('/api/overview');
    expect(response.status).toBe(200);
    expect(response.body.suggestions.map((item: { id: string }) => item.id)).toEqual(['old']);
    await expect(getSettings()).resolves.toMatchObject({ retentionMonths: 0, retentionDays: 10 });
  });
});

describe('inloggen', () => {
  const credentials = { username: 'Michel', password: 'geheim-wachtwoord' };
  const cookieFrom = (response: request.Response) => String(response.headers['set-cookie']?.[0] ?? '').split(';')[0];

  it('is open tot er een account is, daarna alleen met sessie', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    expect((await request(app).get('/api/settings')).status).toBe(200);

    const setup = await request(app).post('/api/auth/setup').send(credentials);
    expect(setup.status).toBe(200);
    expect(setup.headers['set-cookie']?.[0]).toContain('HttpOnly');

    expect((await request(app).get('/api/settings')).status).toBe(401);
    expect((await request(app).get('/api/settings').set('Cookie', cookieFrom(setup))).status).toBe(200);
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/settings').set('Cookie', 'watchsweeperr_session=9999999999999.vervalst')).status).toBe(401);
    // Express routes ignore case; the sign-in check must too.
    expect((await request(app).get('/API/settings')).status).toBe(401);
    expect((await request(app).post('/Api/suggestions/bulk-remove').send({ ids: ['x'], confirmation: true })).status).toBe(401);
  });

  it('controleert wachtwoorden na elkaar, zodat parallel raden niet sneller gaat', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    await request(app).post('/api/auth/setup').send(credentials);
    const started = Date.now();
    const attempts = await Promise.all([1, 2, 3].map(() => request(app).post('/api/auth/login').send({ ...credentials, password: 'fout-wachtwoord' })));
    expect(attempts.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
  });

  it('staat maar één account toe en weigert korte wachtwoorden', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    expect((await request(app).post('/api/auth/setup').send({ username: 'a', password: 'kort' })).status).toBe(400);
    expect((await request(app).post('/api/auth/setup').send(credentials)).status).toBe(200);
    expect((await request(app).post('/api/auth/setup').send(credentials)).status).toBe(409);
  });

  it('logt in met de juiste gegevens, ongeacht hoofdletters in de gebruikersnaam', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    await request(app).post('/api/auth/setup').send(credentials);
    expect((await request(app).post('/api/auth/login').send({ ...credentials, password: 'fout-wachtwoord' })).status).toBe(401);
    const login = await request(app).post('/api/auth/login').send({ ...credentials, username: 'michel' });
    expect(login.status).toBe(200);
    expect((await request(app).get('/api/auth/status').set('Cookie', cookieFrom(login))).body).toMatchObject({ configured: true, authenticated: true, username: 'Michel' });
  });

  it('logt andere sessies uit na een accountwijziging en eist het huidige wachtwoord', async () => {
    const { createApp } = await import('./app.js');
    const app = createApp();
    const oldCookie = cookieFrom(await request(app).post('/api/auth/setup').send(credentials));
    const change = { username: 'Michel', newPassword: 'nieuw-wachtwoord' };

    expect((await request(app).put('/api/auth/account').set('Cookie', oldCookie).send({ ...change, currentPassword: 'fout' })).status).toBe(403);
    const updated = await request(app).put('/api/auth/account').set('Cookie', oldCookie).send({ ...change, currentPassword: credentials.password });
    expect(updated.status).toBe(200);
    expect((await request(app).get('/api/settings').set('Cookie', oldCookie)).status).toBe(401);
    expect((await request(app).get('/api/settings').set('Cookie', cookieFrom(updated))).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ username: 'Michel', password: 'nieuw-wachtwoord' })).status).toBe(200);
  });
});

const liveServices = {
  seerr: { url: 'http://seerr', apiKey: 'seerr-key' },
  tautulli: { url: 'http://tautulli', apiKey: 'tautulli-key' },
  radarr: { url: 'http://radarr', apiKey: 'radarr-key' },
  sonarr: { url: 'http://sonarr', apiKey: 'sonarr-key' }
};

describe('opgeslagen API-keys', () => {
  it('stuurt een opgeslagen key niet naar een nieuwe URL bij het testen', async () => {
    const { saveSettings } = await import('./settingsStore.js');
    const { createApp } = await import('./app.js');
    await saveSettings({ services: liveServices });
    const fetchMock = vi.fn(async () => Response.json({ version: '5' }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await request(createApp()).post('/api/services/radarr/test').send({ url: 'http://elders.example' });
    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('vraagt de key opnieuw bij een gewijzigde URL en behoudt hem bij dezelfde URL', async () => {
    const { saveSettings, getSettings } = await import('./settingsStore.js');
    const { createApp } = await import('./app.js');
    await saveSettings({ services: liveServices });
    const body = (radarrUrl: string) => ({
      demoMode: false, watchThreshold: 90, retentionMonths: 3,
      services: { ...liveServices, radarr: { url: radarrUrl, apiKey: '' }, seerr: { url: 'http://seerr', apiKey: '' } }
    });

    expect((await request(createApp()).put('/api/settings').send(body('http://elders.example'))).status).toBe(400);
    expect((await request(createApp()).put('/api/settings').send(body('http://radarr'))).status).toBe(200);
    await expect(getSettings()).resolves.toMatchObject({ services: { radarr: { url: 'http://radarr', apiKey: 'radarr-key' } } });
  });
});

describe('periodieke scan', () => {
  it('zet een mislukte scan in het activiteitenlogboek', async () => {
    const { saveSettings } = await import('./settingsStore.js');
    const { getState } = await import('./stateStore.js');
    const { scheduledSync } = await import('./app.js');
    await saveSettings({ demoMode: false });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await scheduledSync();

    const [entry] = (await getState()).activity;
    expect(entry).toMatchObject({ type: 'sync', title: 'Scan mislukt', outcome: 'error' });
    expect(entry.detail).toContain('API-key ontbreekt');
  });
});

describe('statusbestand', () => {
  const base = {
    mediaKind: 'movie' as const, subtitle: 'Film', requester: 'Tester', requestedAt: '2026-01-01T00:00:00Z', progress: 100,
    watchedItems: 1, totalItems: 1, status: 'ready' as const, reason: 'Bekeken', matchConfidence: 'high' as const
  };

  it('voert wijzigingen na elkaar uit zodat een trage scan geen klik overschrijft', async () => {
    const { updateState, getState } = await import('./stateStore.js');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow = updateState(async (state) => { await gate; state.lastSyncAt = 'scan'; });
    const click = updateState((state) => { state.ignoredSuggestionIds.push('klik'); });
    release();
    await Promise.all([slow, click]);
    await expect(getState()).resolves.toMatchObject({ lastSyncAt: 'scan', ignoredSuggestionIds: ['klik'] });
  });

  it('bewaart alleen de nieuwste 200 activiteiten en laat geen tijdelijk bestand achter', async () => {
    const { saveState, getState, activity } = await import('./stateStore.js');
    await saveState({ suggestions: [], ignoredSuggestionIds: [], activity: Array.from({ length: 250 }, (_, index) => activity('sync', `scan ${index}`, '')) });
    const state = await getState();
    expect(state.activity).toHaveLength(200);
    expect(state.activity[0].title).toBe('scan 0');
    await expect(readdir(dataDirectory)).resolves.toEqual(['state.json']);
  });

  it('verwijdert de rest en legt alles vast wanneer één titel mislukt', async () => {
    const { saveSettings } = await import('./settingsStore.js');
    const { saveState, getState } = await import('./stateStore.js');
    const { createApp } = await import('./app.js');
    await saveSettings({ demoMode: false, services: liveServices });
    await saveState({
      suggestions: [
        { ...base, id: 'goed', requestId: 1, title: 'Goed', tmdbId: 1 },
        { ...base, id: 'fout', requestId: 2, title: 'Fout', tmdbId: 2 }
      ],
      ignoredSuggestionIds: [],
      activity: []
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v3/movie?tmdbId=1')) return Response.json([{ id: 10, tmdbId: 1 }]);
      if (url.includes('/api/v3/movie?tmdbId=2')) return Response.json([{ id: 20, tmdbId: 2 }]);
      if (url.includes('/api/v3/movie/20') && init?.method === 'DELETE') return new Response('kapot', { status: 500 });
      return new Response(null, { status: 200 });
    }));

    const response = await request(createApp()).post('/api/suggestions/bulk-remove').send({ ids: ['goed', 'fout'], confirmation: true });
    vi.unstubAllGlobals();

    expect(response.status).toBe(502);
    expect(response.body.removed).toBe(1);
    const state = await getState();
    expect(state.suggestions.map((item) => item.status)).toEqual(['removed', 'ready']);
    expect(state.activity.map((item) => item.outcome)).toEqual(['error', 'success']);
  });
});
