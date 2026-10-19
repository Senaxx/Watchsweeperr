import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp, synchronize } from './app.js';
import { getSettings } from './settingsStore.js';
import { SCHEDULED_SYNC_INTERVAL_MS, shouldRunScheduledSync } from './scheduler.js';

const port = Number(process.env.PORT ?? 4173);
const app = createApp();

if (process.env.NODE_ENV === 'production') {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(root, '../dist');
  app.use(express.static(dist));
  app.get('*splat', (_request, response) => response.sendFile(path.join(dist, 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`WatchSweeperr draait op http://localhost:${port}`);
});

const scheduledSync = setInterval(async () => {
  try {
    const settings = await getSettings();
    if (shouldRunScheduledSync(settings)) await synchronize();
  } catch (error) {
    console.error('Periodieke WatchSweeperr-scan mislukt:', error instanceof Error ? error.message : 'Onbekende fout');
  }
}, SCHEDULED_SYNC_INTERVAL_MS);
scheduledSync.unref();
