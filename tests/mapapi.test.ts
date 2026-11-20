import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { openDb, type Db } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { invalidate } from '../server/facts.ts';
import { dryRun, applyImport } from '../server/importer/apply.ts';
import { workbook, COLS, farm } from './helpers.ts';

let db: Db, app: ReturnType<typeof createApp>;
const post = async (p: string, b: unknown) => (await app.request(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json() as Promise<any>;
beforeAll(async () => {
  db = await openDb({ memory: true }); invalidate();
  // 90 farms around Chartres, 10 near Lyon: enough to trigger server-side clustering
  const rows = [...Array.from({ length: 90 }, (_, i) => farm(`NNN-${String(i + 1).padStart(3, '0')}`, { Projet: 'P', Latitude: 48.45 + (i % 9) * 0.02, Longitude: 1.5 + Math.floor(i / 9) * 0.02 })), ...Array.from({ length: 10 }, (_, i) => farm(`SSS-${String(i + 1).padStart(3, '0')}`, { Projet: 'P', Latitude: 45.75 + i * 0.01, Longitude: 4.85 }))];
  const d: any = await dryRun(db, await workbook(COLS, rows), { filename: 't.xlsx' }); await applyImport(db, d.id); app = createApp(db);
});
afterAll(() => db.close());

describe('map: ungroup and selection helpers', () => {
  const view = { bbox: [-6, 41, 10, 52], zoom: 6 };
  it('farms are grouped by default and shown one by one when ungrouped', async () => {
    const g = await post('/api/public/map', { filters: {}, ...view }); expect(g.clusters.length).toBeGreaterThan(0); expect(g.points.length).toBeLessThan(100); expect(g.visible).toBe(100);
    const u = await post('/api/public/map', { filters: {}, ...view, cluster: false }); expect(u.clusters).toEqual([]); expect(u.points).toHaveLength(100); expect(u.capped).toBe(false);
    expect(new Set(u.points.map((p: any) => p.id)).size).toBe(100); expect(JSON.stringify(u)).not.toMatch(/SECRET|DUPONT|VILLESECRETE/);
  });
  it('ids of a selection: by filters, or by a rectangle drawn on the map', async () => {
    expect((await post('/api/public/farm-ids', { filters: {} })).ids).toHaveLength(100);
    const lyon = await post('/api/public/farm-ids', { filters: {}, bbox: [4.5, 45.5, 5.2, 46] }); expect(lyon.total).toBe(10); expect(lyon.ids.every((i: string) => i.startsWith('SSS-'))).toBe(true);
    expect((await post('/api/public/farm-ids', { filters: { ids: ['NNN-001', 'SSS-001'] }, bbox: [4.5, 45.5, 5.2, 46] })).ids).toEqual(['SSS-001']); // filters and rectangle combine (AND)
    expect((await post('/api/public/farm-ids', { filters: {}, bbox: [-30, 10, -20, 20] })).ids).toEqual([]);
    const picked = await post('/api/public/selection', { filters: { ids: lyon.ids } }); expect(picked.scale.farms).toBe(10);
  });
});
