import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActivityItem, AppState, Suggestion } from '../shared.js';
import { dataDirectory, writeJsonFile } from './settingsStore.js';

const statePath = path.join(dataDirectory, 'state.json');

const now = Date.now();
const demoSuggestions: Suggestion[] = [
  {
    id: 'demo-movie-1', requestId: 128, mediaKind: 'movie', title: 'Dune: Part Two', subtitle: 'Film', year: 2024,
    requester: 'Martijn', requestedAt: new Date(now - 38 * 86400000).toISOString(), lastWatchedAt: new Date(now - 2 * 86400000).toISOString(),
    progress: 100, watchedItems: 1, totalItems: 1, status: 'ready', reason: 'Volledig bekeken door aanvrager', matchConfidence: 'high', tmdbId: 693134
  },
  {
    id: 'demo-season-2', requestId: 132, mediaKind: 'season', title: 'Silo', subtitle: 'Seizoen 2', year: 2024,
    requester: 'Sanne', requestedAt: new Date(now - 22 * 86400000).toISOString(), lastWatchedAt: new Date(now - 86400000).toISOString(),
    progress: 100, watchedItems: 10, totalItems: 10, status: 'ready', reason: '10 van 10 afleveringen bekeken', matchConfidence: 'high', tvdbId: 403245, seasonNumber: 2
  },
  {
    id: 'demo-season-3', requestId: 137, mediaKind: 'season', title: 'The Bear', subtitle: 'Seizoen 3', year: 2024,
    requester: 'Joost', requestedAt: new Date(now - 14 * 86400000).toISOString(), lastWatchedAt: new Date(now - 3 * 86400000).toISOString(),
    progress: 70, watchedItems: 7, totalItems: 10, status: 'partial', reason: '7 van 10 afleveringen bekeken', matchConfidence: 'high', tvdbId: 393589, seasonNumber: 3
  },
  {
    id: 'demo-movie-4', requestId: 140, mediaKind: 'movie', title: 'Furiosa: A Mad Max Saga', subtitle: 'Film', year: 2024,
    requester: 'Nina', requestedAt: new Date(now - 8 * 86400000).toISOString(), progress: 0, watchedItems: 0, totalItems: 1,
    status: 'waiting', reason: 'Nog niet bekeken', matchConfidence: 'medium', tmdbId: 786892
  }
];

const initialState: AppState = {
  suggestions: demoSuggestions,
  ignoredSuggestionIds: [],
  activity: [{
    id: 'demo-activity', type: 'sync', title: 'Demogegevens geladen', detail: 'Configureer services om echte verzoeken te controleren.',
    createdAt: new Date(now).toISOString(), outcome: 'info'
  }]
};

export async function getState(): Promise<AppState> {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8')) as AppState;
    return { ...state, ignoredSuggestionIds: state.ignoredSuggestionIds ?? [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return structuredClone(initialState);
    throw error;
  }
}

const ACTIVITY_LIMIT = 200;

export async function saveState(state: AppState): Promise<void> {
  state.activity = state.activity.slice(0, ACTIVITY_LIMIT);
  await writeJsonFile(statePath, state);
}

let stateQueue: Promise<unknown> = Promise.resolve();

// Runs read-change-save steps one at a time, so a slow scan cannot overwrite a click made meanwhile.
export function updateState<T>(change: (state: AppState) => T | Promise<T>): Promise<T> {
  const run = stateQueue.then(async () => {
    const state = await getState();
    const result = await change(state);
    await saveState(state);
    return result;
  });
  stateQueue = run.catch(() => undefined);
  return run;
}

export function activity(type: ActivityItem['type'], title: string, detail: string, outcome: ActivityItem['outcome'] = 'success'): ActivityItem {
  return { id: crypto.randomUUID(), type, title, detail, outcome, createdAt: new Date().toISOString() };
}
