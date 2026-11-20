import './env.ts';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { openDb } from './db.ts';
import { createApp } from './app.ts';

const db = await openDb();
const port = Number(process.env.PORT ?? 8787);
// locally: 127.0.0.1 (web served by Vite on :5173). Online: HOST=0.0.0.0 and the built web (dist/) is served here too.
const hostname = process.env.HOST ?? '127.0.0.1';

const api = createApp(db);
let app: { fetch: typeof api.fetch } = api;
if (existsSync('dist/index.html')) {
  const indexHtml = readFileSync('dist/index.html', 'utf8');
  const root = new Hono();
  // embeddable widget: framing allowed on /widget/* only (README, Phase 8)
  root.use('*', async (c, next) => {
    await next();
    if (c.req.path.startsWith('/widget/')) c.header('Content-Security-Policy', 'frame-ancestors *');
    else { c.header('X-Frame-Options', 'DENY'); c.header('Content-Security-Policy', "frame-ancestors 'self'"); }
  });
  root.get('/healthz', c => c.text('ok'));
  root.route('/', api);
  root.use('*', serveStatic({ root: './dist' }));
  root.get('*', c => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(indexHtml))); // SPA routes
  app = root;
}
serve({ fetch: app.fetch, port, hostname }, () => console.log(`Farmgate Credits → http://${hostname}:${port}`));
