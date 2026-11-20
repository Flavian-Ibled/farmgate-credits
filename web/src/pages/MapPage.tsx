import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, CircleMarker, Marker, Popup, Circle, Polygon, GeoJSON, useMapEvents, useMap } from 'react-leaflet';
import { unzipSync, strFromU8 } from 'fflate';
import L from 'leaflet';
import { api, fmt, STATUS_COLOR, type Filters } from '../api';
import SelectionPanel from '../components/SelectionPanel';

function Multi({ label, options, value, onChange }: { label: string; options: { key: string; farms?: number; label?: string }[]; value?: string[]; onChange: (v: string[]) => void }) {
  const v = value ?? [];
  return (
    <details className="border-b border-line py-2" open={v.length > 0}>
      <summary className="cursor-pointer text-sm font-semibold flex justify-between">{label}{v.length > 0 && <span className="badge bg-leaf text-white">{v.length}</span>}</summary>
      <div className="mt-2 max-h-48 overflow-auto pr-1">
        {options.filter(o => o.key !== '—').map(o => (<label key={o.key} className="flex items-start gap-2 text-sm py-0.5"><input type="checkbox" className="mt-1" checked={v.includes(o.key)} onChange={e => onChange(e.target.checked ? [...v, o.key] : v.filter(x => x !== o.key))} /><span className="flex-1">{o.label ?? o.key}</span>{o.farms != null && <span className="tabular-nums opacity-70">{o.farms}</span>}</label>))}
      </div>
    </details>
  );
}

/** Zone mode: drag a rectangle on the map; the farms inside (matching the filters) are added to the selection. */
function ZoneSelect({ active, onZone }: { active: boolean; onZone: (b: number[]) => void }) {
  const map = useMap(); const cb = useRef(onZone); cb.current = onZone;
  useEffect(() => {
    if (!active) return; let start: L.LatLng | null = null; let rect: L.Rectangle | null = null; map.dragging.disable(); map.doubleClickZoom.disable();
    const down = (e: L.LeafletMouseEvent) => { start = e.latlng; rect = L.rectangle(L.latLngBounds(e.latlng, e.latlng), { color: '#885104', weight: 2, fillOpacity: 0.12 }).addTo(map); };
    const move = (e: L.LeafletMouseEvent) => { if (start && rect) rect.setBounds(L.latLngBounds(start, e.latlng)); };
    const up = (e: L.LeafletMouseEvent) => { if (!start) return; const b = L.latLngBounds(start, e.latlng); rect?.remove(); rect = null; start = null; if (b.getNorth() !== b.getSouth() && b.getEast() !== b.getWest()) cb.current([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]); };
    map.on('mousedown', down); map.on('mousemove', move); map.on('mouseup', up);
    return () => { map.off('mousedown', down); map.off('mousemove', move); map.off('mouseup', up); rect?.remove(); map.dragging.enable(); map.doubleClickZoom.enable(); };
  }, [active, map]);
  return null;
}

function Viewport({ onChange }: { onChange: (b: number[], z: number) => void }) {
  const map = useMapEvents({ moveend: () => emit(), zoomend: () => emit() });
  const emit = () => { const b = map.getBounds(); onChange([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], map.getZoom()); };
  useEffect(() => { emit(); }, []);
  return null;
}

export default function MapPage() {
  const { t } = useTranslation();
  const [sp, setSp] = useSearchParams();
  const filters: Filters = useMemo(() => { try { return JSON.parse(sp.get('f') ?? '{}'); } catch { return {}; } }, [sp]);
  const setFilters = (f: Filters) => { const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))); setSp(Object.keys(clean).length ? { f: JSON.stringify(clean) } : {}, { replace: true }); };
  const patch = (p: Partial<Filters>) => setFilters({ ...filters, ...p });
  const [meta, setMeta] = useState<any>(null), [sel, setSel] = useState<any>(null), [mapData, setMapData] = useState<any>({ clusters: [], points: [] });
  const [view, setView] = useState<'map' | 'list'>('map'), [panel, setPanel] = useState<'filters' | 'selection'>('selection');
  const [vp, setVp] = useState<{ b: number[]; z: number } | null>(null);
  const [list, setList] = useState<any>(null), [page, setPage] = useState(1), [copied, setCopied] = useState(false), [err, setErr] = useState('');
  const [cq, setCq] = useState(''), [cres, setCres] = useState<any[]>([]);
  const mapRef = useRef<L.Map | null>(null);
  const [layers, setLayers] = useState<{ depts: boolean; bassins: boolean; rivers: boolean }>({ depts: false, bassins: false, rivers: false });
  const [geo, setGeo] = useState<Record<string, any>>({});
  const filtersRef = useRef(filters); filtersRef.current = filters;
  useEffect(() => { for (const [k, file] of [['depts', 'dept_geojson'], ['bassins', 'bv_data'], ['rivers', 'fleuves_data']] as const) if ((layers[k] || (k === 'rivers' && filters.river)) && !geo[k]) fetch(`/geo/${file}.json`).then(r => r.json()).then(j => setGeo(g => ({ ...g, [k]: j }))).catch(() => {}); }, [layers, filters.river?.name]);
  const toggle = (k: 'departement' | 'bassin', v: string) => { const cur = filtersRef.current[k] ?? []; setFilters({ ...filtersRef.current, [k]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] }); };
  const exportXlsx = async () => { const r = await fetch('/api/public/selection.xlsx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filters: eff }) }); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'farmgate_selection.xlsx'; a.click(); URL.revokeObjectURL(a.href); };
  const fkey = JSON.stringify(filters);
  // multi-selection: independent from the filters, kept for the session so that the admin can reuse it (funder attribution)
  const [picked, setPickedState] = useState<string[]>(() => { try { return JSON.parse(sessionStorage.getItem('fg_picked') ?? '[]'); } catch { return []; } });
  const setPicked = (ids: string[]) => { const u = [...new Set(ids)].slice(0, 3000); setPickedState(u); try { sessionStorage.setItem('fg_picked', JSON.stringify(u)); } catch { /* private mode */ } };
  const pickToggle = (id: string) => setPicked(picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id]);
  const togglePage = (ids: string[], on: boolean) => setPicked(on ? [...picked, ...ids] : picked.filter(x => !ids.includes(x)));
  const [mode, setMode] = useState<'browse' | 'pick' | 'zone'>('browse'), [note, setNote] = useState('');
  const [ungroup, setUngroupState] = useState(() => { try { return sessionStorage.getItem('fg_ungroup') === '1'; } catch { return false; } });
  const setUngroup = (v: boolean) => { setUngroupState(v); try { sessionStorage.setItem('fg_ungroup', v ? '1' : '0'); } catch { /* */ } };
  const eff: Filters = picked.length ? { ids: picked } : filters; const efkey = JSON.stringify(eff);
  const addZone = async (bbox: number[]) => { try { const r = await api('/public/farm-ids', { filters, bbox }); const before = new Set(picked); setPicked([...picked, ...r.ids]); setNote(t('mp.zoneAdded', { n: r.ids.filter((i: string) => !before.has(i)).length })); } catch (e: any) { setErr(e.message); } };
  const selectAll = async () => { try { const r = await api('/public/farm-ids', { filters }); setPicked(r.ids); setNote(t('mp.allDone', { n: r.ids.length, t: r.total })); } catch (e: any) { setErr(e.message); } };

  const [me, setMe] = useState<any>(null);
  useEffect(() => { api('/public/meta').then(setMeta).catch(e => setErr(e.message)); api('/auth/me').then(setMe).catch(() => {}); }, []);
  const quote = async () => { const v = prompt(t('fo.quoteVol')); if (!v) return; try { const r = await api('/funder/quotes', { filters: eff, volume_tco2e: v.replace(',', '.') }); setErr(t('fo.quoteDone', { ref: r.reference })); } catch (e: any) { setErr(e.message); } };
  useEffect(() => { setSel(null); api('/public/selection', { filters: eff }).then(setSel).catch(e => setErr(e.message)); setPage(1); }, [efkey]);
  useEffect(() => { if (vp) api('/public/map', { filters, bbox: vp.b, zoom: vp.z, cluster: !ungroup }).then(setMapData).catch(() => {}); }, [fkey, vp, ungroup]);
  useEffect(() => { if (view === 'list') api('/public/farms', { filters, page, size: 25 }).then(setList).catch(() => {}); }, [fkey, page, view]);
  useEffect(() => { if (cq.length < 2) { setCres([]); return; } const h = setTimeout(() => api(`/public/communes?q=${encodeURIComponent(cq)}`).then(r => setCres(Array.isArray(r) ? r : [])).catch(() => setCres([])), 250); return () => clearTimeout(h); }, [cq]);

  const onZone = async (file?: File) => {
    if (!file) return;
    try {
      const name = file.name.toLowerCase(); let ring: number[][] | null = null;
      if (name.endsWith('.kml') || name.endsWith('.kmz')) {
        let xml: string;
        if (name.endsWith('.kmz')) { const z = unzipSync(new Uint8Array(await file.arrayBuffer())); const k = Object.keys(z).find(n => n.toLowerCase().endsWith('.kml')); if (!k) throw new Error('aucun .kml dans le KMZ'); xml = strFromU8(z[k]); } else xml = await file.text();
        const doc = new DOMParser().parseFromString(xml, 'text/xml'); const poly = doc.getElementsByTagName('Polygon')[0]; const co = (poly ?? doc).getElementsByTagName('coordinates')[0]?.textContent ?? '';
        ring = co.trim().split(/\s+/).map(s => s.split(',').map(Number)).filter(p => p.length >= 2 && p.every(Number.isFinite));
        if (!poly || ring.length < 3) throw new Error('aucun polygone trouvé dans le fichier');
      } else { const g = JSON.parse(await file.text()); const geom = g.type === 'FeatureCollection' ? g.features[0].geometry : g.type === 'Feature' ? g.geometry : g; ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : null; if (!ring) throw new Error('polygone attendu'); }
      patch({ polygon: ring!.map(p => [p[0], p[1]] as [number, number]) });
    } catch (e: any) { setErr('Zone : ' + e.message); }
  };
  const chips: [string, () => void][] = [];
  for (const k of ['project', 'porteur', 'region', 'departement', 'typology', 'status'] as const) for (const v of filters[k] ?? []) chips.push([v, () => patch({ [k]: filters[k]!.filter(x => x !== v) })]);
  for (const v of filters.levers ?? []) chips.push([meta?.levers.find((l: any) => l.code === v)?.name_fr ?? v, () => patch({ levers: filters.levers!.filter(x => x !== v) })]);
  if (filters.sau_min != null) chips.push([`SAU ≥ ${filters.sau_min}`, () => patch({ sau_min: undefined })]);
  if (filters.sau_max != null) chips.push([`SAU ≤ ${filters.sau_max}`, () => patch({ sau_max: undefined })]);
  if (filters.available_min != null) chips.push([`≥ ${filters.available_min} tCO₂e`, () => patch({ available_min: undefined })]);
  for (const v of filters.bassin ?? []) chips.push([v, () => patch({ bassin: filters.bassin!.filter(x => x !== v) })]);
  if (filters.river) chips.push([`${filters.river.name} ≤ ${filters.river.km} km`, () => patch({ river: undefined })]);
  if (filters.near) chips.push([`${filters.near.label ?? ''} · ${filters.near.km} km`, () => patch({ near: undefined })]);
  if (filters.polygon) chips.push([t('f.zone'), () => patch({ polygon: undefined })]);
  if (filters.ids?.length) chips.push([`${filters.ids.length} id`, () => patch({ ids: undefined })]);
  const num = (s: string) => (s === '' ? undefined : Number(s));

  const pickBar = (
    <div className="w-full flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={t('mp.selection')}>
      <span className={`badge ${picked.length ? 'bg-soil text-white' : 'bg-mist'}`} aria-live="polite">{t('mp.picked', { count: picked.length })}</span>
      <button className="btn-ghost" aria-pressed={mode === 'pick'} onClick={() => setMode(mode === 'pick' ? 'browse' : 'pick')}>{mode === 'pick' ? '✓ ' : ''}{t('mp.modePick')}</button>
      <button className="btn-ghost" aria-pressed={mode === 'zone'} onClick={() => setMode(mode === 'zone' ? 'browse' : 'zone')}>{mode === 'zone' ? '✓ ' : ''}▭ {t('mp.modeZone')}</button>
      <button className="btn-ghost" onClick={selectAll}>{t('mp.all')}</button>
      {picked.length > 0 && <><button className="btn-ghost" onClick={() => setPicked([])}>{t('mp.clear')}</button><button className="btn-ghost" title={t('mp.asFilterHint')} onClick={() => { patch({ ids: picked }); setPicked([]); }}>{t('mp.asFilter')}</button>{['platform_admin', 'staff'].includes(me?.role) && <Link className="btn" to="/admin">{t('mp.toFunder')}</Link>}</>}
      {mode !== 'browse' && <span className="text-xs opacity-75">{mode === 'pick' ? t('mp.hintPick') : t('mp.hintZone')}</span>}{note && <span role="status" className="text-xs font-medium">{note}</span>}
    </div>);
  const filtersUi = meta && (
    <div className="p-4">
      <div className="flex items-center justify-between mb-1"><h2 className="text-lg font-bold">{t('f.title')}</h2><button className="btn-ghost" onClick={() => setFilters({})}>{t('f.reset')}</button></div>
      <Multi label={t('f.project')} options={meta.projects} value={filters.project} onChange={v => patch({ project: v })} />
      <Multi label={t('f.porteur')} options={meta.porteurs.map((p: string) => ({ key: p }))} value={filters.porteur} onChange={v => patch({ porteur: v })} />
      <Multi label={t('f.region')} options={meta.regions} value={filters.region} onChange={v => patch({ region: v })} />
      <Multi label={t('f.departement')} options={meta.departements} value={filters.departement} onChange={v => patch({ departement: v })} />
      <Multi label={t('f.bassin')} options={meta.bassins.map((b: string) => ({ key: b }))} value={filters.bassin} onChange={v => patch({ bassin: v })} />
      <Multi label={t('f.typology')} options={meta.typologies} value={filters.typology} onChange={v => patch({ typology: v })} />
      <Multi label={t('f.status')} options={meta.statuses} value={filters.status} onChange={v => patch({ status: v })} />
      <Multi label={t('f.levers')} options={meta.levers.map((l: any) => ({ key: l.code, label: l.name_fr }))} value={filters.levers} onChange={v => patch({ levers: v })} />
      <fieldset className="border-b border-line py-2"><legend className="text-sm font-semibold">{t('f.sau')}</legend><div className="flex gap-2 mt-1">
        <input aria-label={`${t('f.sau')} ${t('f.min')}`} type="number" min={0} placeholder={t('f.min')} className="w-full border border-line rounded px-2 py-1 text-sm" defaultValue={filters.sau_min ?? ''} key={'a' + (filters.sau_min ?? '')} onBlur={e => patch({ sau_min: num(e.target.value) })} />
        <input aria-label={`${t('f.sau')} ${t('f.max')}`} type="number" min={0} placeholder={t('f.max')} className="w-full border border-line rounded px-2 py-1 text-sm" defaultValue={filters.sau_max ?? ''} key={'b' + (filters.sau_max ?? '')} onBlur={e => patch({ sau_max: num(e.target.value) })} /></div></fieldset>
      <label className="block border-b border-line py-2 text-sm font-semibold">{t('f.available')}<input type="number" min={0} className="mt-1 w-full border border-line rounded px-2 py-1 text-sm font-normal" defaultValue={filters.available_min ?? ''} key={'c' + (filters.available_min ?? '')} onBlur={e => patch({ available_min: num(e.target.value) })} /></label>
      <div className="border-b border-line py-2"><label className="text-sm font-semibold block">{t('f.commune')}<input type="search" value={cq} onChange={e => setCq(e.target.value)} className="mt-1 w-full border border-line rounded px-2 py-1 text-sm font-normal" autoComplete="off" /></label>
        {cres.length > 0 && <ul className="mt-1 border border-line rounded bg-white">{cres.map(c => <li key={c.name + c.departement}><button className="w-full text-left px-2 py-1 text-sm hover:bg-cream" onClick={() => { patch({ near: { lat: c.lat, lng: c.lng, km: filters.near?.km ?? 30, label: c.name } }); setCq(''); mapRef.current?.setView([c.lat, c.lng], 9); }}>{c.name} ({c.departement})</button></li>)}</ul>}
        {filters.near && <label className="text-sm block mt-2">{t('f.radius')} : {filters.near.km}<input type="range" min={5} max={150} step={5} value={filters.near.km} onChange={e => patch({ near: { ...filters.near!, km: Number(e.target.value) } })} className="w-full" /></label>}</div>
      <div className="border-b border-line py-2"><label className="text-sm font-semibold block">{t('f.river')}<select className="mt-1 w-full border border-line rounded px-2 py-1 text-sm font-normal bg-white" value={filters.river?.name ?? ''} onChange={e => patch({ river: e.target.value ? { name: e.target.value, km: filters.river?.km ?? 10 } : undefined })}><option value="">{t('f.riverNone')}</option>{meta.rivers.map((r: string) => <option key={r}>{r}</option>)}</select></label>
        {filters.river && <label className="text-sm block mt-2">{t('f.radius')} : {filters.river.km}<input type="range" min={1} max={50} step={1} value={filters.river.km} onChange={e => patch({ river: { ...filters.river!, km: Number(e.target.value) } })} className="w-full" /></label>}</div>
      <label className="block border-b border-line py-2 text-sm font-semibold">{t('f.ids')}<textarea rows={2} placeholder="CVL2-062, ADA-001…" className="mt-1 w-full border border-line rounded px-2 py-1 text-sm font-normal" defaultValue={(filters.ids ?? []).join(', ')} key={'i' + (filters.ids ?? []).join()} onBlur={e => patch({ ids: e.target.value.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean) })} /></label>
      <label className="block py-2 text-sm font-semibold">{t('f.zone')}<input type="file" accept=".kml,.kmz,.geojson,.json,application/geo+json" className="mt-1 block w-full text-sm font-normal" onChange={e => onZone(e.target.files?.[0])} /></label>
      <p className="text-xs opacity-75 mt-2">{t('f.blurNote')} {t('f.basinNote')}</p>
    </div>);

  return (
    <div className="lg:h-[calc(100vh-3.5rem)] flex flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-line bg-white">
        <div role="group" aria-label="Vue" className="flex rounded-lg border border-line overflow-hidden">{(['map', 'list'] as const).map(v => <button key={v} aria-pressed={view === v} onClick={() => setView(v)} className={`px-3 py-1.5 text-sm font-medium ${view === v ? 'bg-soil text-white' : 'bg-white'}`}>{t(`v.${v}`)}</button>)}</div>
        <div role="group" className="flex lg:hidden rounded-lg border border-line overflow-hidden">{(['filters', 'selection'] as const).map(v => <button key={v} aria-pressed={panel === v} onClick={() => setPanel(v)} className={`px-3 py-1.5 text-sm font-medium ${panel === v ? 'bg-leaf text-white' : 'bg-white'}`}>{v === 'filters' ? t('f.title') : t('v.selection')}</button>)}</div>
        <div aria-live="polite" className="text-xs sm:text-sm tabular-nums order-last sm:order-none w-full sm:w-auto"><strong>{fmt(sel?.scale.farms)}</strong> {t('kpi.farms')} · <strong>{fmt(sel?.scale.sau)}</strong> ha · <strong>{fmt(sel?.carbon.re_labelled_5y)}</strong> tCO₂e · <strong>{fmt(sel?.carbon.vol_dispo)}</strong> {t('kpi.available')}</div>
        {me?.role?.startsWith('funder') && <button className="btn ml-auto" onClick={quote}>{t('fo.quote')}</button>}
        <Link className={`btn-ghost ${me?.role?.startsWith('funder') ? '' : 'ml-auto'}`} to={`/selection?f=${encodeURIComponent(JSON.stringify(eff))}`}>{t('rk.rank')}</Link>
        <button className="btn-ghost" onClick={exportXlsx}>{t('f.export')}</button>
        <button className="btn-ghost" onClick={() => { navigator.clipboard?.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? t('f.copied') : t('f.share')}</button>
        {pickBar}
        {chips.length > 0 && <ul className="w-full flex flex-wrap gap-1">{chips.map(([label, rm], i) => <li key={i}><button onClick={rm} className="badge bg-leaf/10 border border-leaf/30 hover:bg-leaf/20" aria-label={`Retirer le filtre ${label}`}>{label} ✕</button></li>)}</ul>}
        {err && <p role="alert" className="w-full text-sm text-red-700">{err} <button className="underline" onClick={() => setErr('')}>ok</button></p>}
      </div>
      <div className="flex-1 min-h-0 grid lg:grid-cols-[300px_1fr_380px]">
        <aside aria-label={t('f.title')} className={`${panel === 'filters' ? '' : 'hidden'} lg:block overflow-auto bg-white border-r border-line order-2 lg:order-1`}>{filtersUi ?? <p className="p-4">{t('loading')}</p>}</aside>
        <section className="order-1 lg:order-2 h-[52vh] lg:h-auto min-h-0 relative">
          {view === 'map' ? (
            <MapContainer center={[47.2, 2.6]} zoom={6} minZoom={5} maxZoom={12} className={`h-full w-full z-0 ${mode === 'zone' ? 'fg-crosshair' : ''}`} ref={mapRef as any}>
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <ZoneSelect active={mode === 'zone'} onZone={addZone} /><Viewport onChange={(b, z) => setVp({ b, z })} />
              {layers.depts && geo.depts && <GeoJSON key={'d' + (filters.departement ?? []).join()} data={geo.depts} style={(f: any) => { const on = (filters.departement ?? []).includes(f.properties.code); return { color: '#1e4414', weight: on ? 2 : 0.6, fillColor: '#529a38', fillOpacity: on ? 0.25 : 0.02 }; }} onEachFeature={(f: any, l: any) => { l.bindTooltip(`${f.properties.nom} (${f.properties.code})`, { sticky: true }); l.on('click', () => toggle('departement', f.properties.code)); }} />}
              {layers.bassins && geo.bassins && <GeoJSON key={'b' + (filters.bassin ?? []).join()} data={geo.bassins} style={(f: any) => { const on = (filters.bassin ?? []).includes(f.properties.nom); return { color: f.properties.couleur ?? '#15538B', weight: on ? 3 : 1.5, fillColor: f.properties.couleur ?? '#15538B', fillOpacity: on ? 0.3 : 0.12 }; }} onEachFeature={(f: any, l: any) => { l.bindTooltip(f.properties.nom, { sticky: true }); l.on('click', () => toggle('bassin', f.properties.nom)); }} />}
              {geo.rivers && (layers.rivers || filters.river) && <GeoJSON key={'r' + layers.rivers + (filters.river?.name ?? '')} data={{ ...geo.rivers, features: geo.rivers.features.filter((f: any) => layers.rivers || f.properties.nom === filters.river?.name) }} style={(f: any) => ({ color: '#15538B', weight: f.properties.nom === filters.river?.name ? 4 : 1.5, opacity: 0.8 })} onEachFeature={(f: any, l: any) => { l.bindTooltip(f.properties.nom, { sticky: true }); l.on('click', () => setFilters({ ...filtersRef.current, river: { name: f.properties.nom, km: filtersRef.current.river?.km ?? 10 } })); }} />}
              {filters.near && <Circle center={[filters.near.lat, filters.near.lng]} radius={filters.near.km * 1000} pathOptions={{ color: '#885104', weight: 1.5, fillOpacity: 0.06 }} />}
              {filters.polygon && <Polygon positions={filters.polygon.map(p => [p[1], p[0]] as [number, number])} pathOptions={{ color: '#3B2A1E', weight: 1, fillOpacity: 0.05 }} />}
              {mapData.clusters.map((c: any) => { const s = c.n < 10 ? 30 : c.n < 50 ? 38 : c.n < 200 ? 46 : 54; return (
                <Marker key={`c${c.lat},${c.lng}`} position={[c.lat, c.lng]} icon={L.divIcon({ html: `<div class="fg-cluster" style="width:${s}px;height:${s}px">${c.n}</div>`, className: '', iconSize: [s, s] })} title={`${c.n} fermes · ${c.sau} ha`} eventHandlers={{ click: e => e.target._map.setView([c.lat, c.lng], Math.min(12, e.target._map.getZoom() + 2)) }} />); })}
              {mapData.points.map((p: any) => (
                <CircleMarker key={p.id + (picked.includes(p.id) ? '*' : '')} center={[p.lat, p.lng]} radius={picked.includes(p.id) ? 9 : 7} pathOptions={{ color: picked.includes(p.id) ? '#1e4414' : '#fff', weight: picked.includes(p.id) ? 3.5 : 1.5, fillColor: STATUS_COLOR[p.status] ?? '#888', fillOpacity: 0.95 }} eventHandlers={{ click: () => { if (mode === 'pick') pickToggle(p.id); } }}>
                  {mode !== 'pick' && <Popup><div className="text-sm"><div className="font-bold text-soil text-base">{t('farm.anonymous')} {p.id}</div><div>{p.project}</div><div>{p.typology} · {p.status}</div><div className="tabular-nums">{fmt(p.sau)} ha · {fmt(p.dispo)} tCO₂e {t('kpi.available').replace('tCO₂e ', '')}</div>
                    <div className="mt-2 flex gap-2"><Link className="btn !py-1 !text-white" to={`/fermes/${p.id}`}>{t('fp.sheet')}</Link><button className="btn-ghost !py-1" onClick={() => pickToggle(p.id)}>{picked.includes(p.id) ? t('mp.remove') : t('mp.add')}</button></div></div></Popup>}
                </CircleMarker>))}
            </MapContainer>
          ) : (
            <div className="h-full overflow-auto bg-white p-4">
              {!list ? <p>{t('loading')}</p> : (<>
                <table className="w-full text-sm"><caption className="sr-only">{t('v.list')}</caption><thead><tr className="text-left border-b border-line"><th className="py-2 pr-2"><input type="checkbox" aria-label={t('mp.selPage')} checked={list.rows.length > 0 && list.rows.every((r: any) => picked.includes(r.id))} onChange={e => togglePage(list.rows.map((r: any) => r.id), e.target.checked)} /></th>{[t('list.id'), t('f.project'), t('f.departement'), t('f.typology'), t('f.status'), 'SAU (ha)', 'tCO₂e (5 ans)', t('kpi.available')].map(h => <th key={h} className="py-2 pr-2 font-semibold">{h}</th>)}</tr></thead>
                  <tbody>{list.rows.map((r: any) => <tr key={r.id} className="border-b border-line"><td className="py-1.5 pr-2"><input type="checkbox" aria-label={r.id} checked={picked.includes(r.id)} onChange={() => pickToggle(r.id)} /></td><td className="py-1.5 pr-2 font-medium"><Link className="underline" to={`/fermes/${r.id}`}>{r.id}</Link></td><td className="pr-2">{r.project ?? '—'}</td><td className="pr-2">{r.departement ?? '—'}</td><td className="pr-2">{r.typology ?? '—'}</td><td className="pr-2"><span className="badge text-white" style={{ background: STATUS_COLOR[r.status] ?? '#888' }}>{r.status ?? '—'}</span></td><td className="pr-2 tabular-nums">{fmt(r.sau)}</td><td className="pr-2 tabular-nums">{fmt(r.re_labelled)}</td><td className="tabular-nums">{fmt(r.dispo)}</td></tr>)}</tbody></table>
                <div className="mt-3 flex items-center gap-2 text-sm"><button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('list.prev')}</button><span>{t('list.page', { p: page, t: Math.max(1, Math.ceil(list.total / list.size)) })}</span><button className="btn-ghost" disabled={page * list.size >= list.total} onClick={() => setPage(page + 1)}>{t('list.next')}</button></div></>)}
            </div>)}
          {view === 'map' && <fieldset className="absolute top-3 right-3 z-[500] card px-3 py-2 text-xs" title={t('f.layerHint')}><legend className="sr-only">{t('f.layers')}</legend><label className="flex items-center gap-2 py-0.5 mb-1 border-b border-line font-medium"><input type="checkbox" checked={ungroup} onChange={e => setUngroup(e.target.checked)} />{t('mp.ungroup')}</label>{([['depts', t('f.lDepts')], ['bassins', t('f.lBassins')], ['rivers', t('f.lRivers')]] as const).map(([k, label]) => <label key={k} className="flex items-center gap-2 py-0.5"><input type="checkbox" checked={layers[k]} onChange={e => setLayers({ ...layers, [k]: e.target.checked })} />{label}</label>)}</fieldset>}
          {view === 'map' && <ul className="absolute bottom-3 left-3 z-[500] card px-3 py-2 text-xs space-y-0.5 hidden sm:block">{Object.entries(STATUS_COLOR).map(([k, c]) => <li key={k} className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full" style={{ background: c }} />{k}</li>)}</ul>}
        </section>
        <aside aria-label={t('v.selection')} className={`${panel === 'selection' ? '' : 'hidden'} lg:block overflow-auto bg-white border-l border-line order-3`}>{meta ? <SelectionPanel sel={sel} meta={meta} /> : <p className="p-4">{t('loading')}</p>}</aside>
      </div>
    </div>
  );
}
