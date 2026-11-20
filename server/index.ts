import { serve } from '@hono/node-server';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
const db = await openDb();
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(db).fetch, port, hostname: '127.0.0.1' }, () => console.log(`Farmgate Credits API → http://127.0.0.1:${port}`));
