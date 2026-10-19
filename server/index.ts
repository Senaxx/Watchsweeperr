import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp, scheduledSync } from './app.js';

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

setInterval(scheduledSync, 60 * 60 * 1000).unref();
