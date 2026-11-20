// Admin: thresholds and weights of the Eau and Biodiversité scores (every save creates a new version), and import of a selection workbook.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, fmt } from '../api';

const inp = 'border border-line rounded px-2 py-1 text-sm bg-white';
export default function AdminScores() {
  const { t } = useTranslation(); const [list, setList] = useState<any[]>([]), [score, setScore] = useState('eau'), [cfg, setCfg] = useState<any>(null), [msg, setMsg] = useState(''), [file, setFile] = useState<File | null>(null), [res, setRes] = useState<any>(null);
  const load = () => api('/admin/scores').then((l: any[]) => { setList(l); const c = l.find(x => x.score === score); if (c) setCfg(structuredClone(c.config)); }).catch(e => setMsg(e.message));
  useEffect(() => { load(); }, [score]);
  const meta = list.find(x => x.score === score); const items: [string, any][] = cfg ? (Array.isArray(cfg.items) ? cfg.items.map((i: any, k: number) => [String(k), i]) : Object.entries(cfg.items)) : [];
  const sum = items.reduce((s, [, i]) => s + (Number(i.weight) || 0), 0);
  const set = (k: string, f: string, v: string) => setCfg((c: any) => { const n = structuredClone(c); (Array.isArray(n.items) ? n.items[Number(k)] : n.items[k])[f] = v; return n; });
  const save = async (status: string) => { setMsg(''); try { const r = await api(`/admin/scores/${score}`, { config: cfg, status }, { method: 'PUT' }); setMsg(t('sc.saved', { v: r.version })); load(); } catch (e: any) { setMsg(e.message); } };
  const send = async (apply: boolean) => { if (!file) return; setMsg(''); const fd = new FormData(); fd.set('file', file); if (apply) fd.set('apply', '1'); try { setRes(await api('/admin/scores/selection-workbook', fd)); } catch (e: any) { setMsg(e.message); } };
  return (
    <section className="mt-8"><h2 className="text-xl font-bold">{t('sc.title')}</h2><p className="text-sm mt-1 max-w-3xl">{t('sc.hint')}</p>
      <div className="flex flex-wrap items-center gap-2 mt-2">{[['eau', t('rk.eau')], ['biodiversite', t('rk.bio')]].map(([k, l]) => <button key={k} aria-pressed={score === k} onClick={() => setScore(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${score === k ? 'bg-soil text-white' : 'bg-white border border-line'}`}>{l}</button>)}{meta && <span className="text-sm">v{meta.version} · {meta.status === 'valide' ? t('cfg.validated') : 'à valider'} · {meta.author} · {new Date(meta.created_at).toLocaleDateString()}</span>}</div>
      {msg && <p role="status" className="mt-2 text-sm font-medium">{msg}</p>}
      {cfg && <div className="card p-4 mt-2">
        <div className="flex flex-wrap gap-3 items-end">{score === 'eau' && <label className="text-xs">{t('sc.basis')}<select className={inp + ' block mt-1'} value={cfg.level_basis} onChange={e => setCfg({ ...cfg, level_basis: e.target.value })}><option value="initial">{t('rk.bInit')}</option><option value="prospectif">{t('rk.bPros')}</option></select></label>}
          <label className="text-xs">{t('sc.floor')}<input type="number" className={inp + ' block mt-1 w-20'} value={cfg.floor} onChange={e => setCfg({ ...cfg, floor: e.target.value })} /></label><label className="text-xs">{t('sc.ceiling')}<input type="number" className={inp + ' block mt-1 w-20'} value={cfg.ceiling} onChange={e => setCfg({ ...cfg, ceiling: e.target.value })} /></label>
          <span className={`text-sm font-bold ml-auto ${Math.abs(sum - 1) > 1e-9 ? 'text-red-700' : 'text-leaf-dark'}`}>{t('sc.sum')} : {fmt(sum * 100, 1)} %</span></div>
        <div className="overflow-x-auto max-h-[28rem] mt-2"><table className="w-full text-sm"><thead className="sticky top-0 bg-white"><tr className="text-left border-b border-line"><th className="py-1.5 font-semibold">{t('sc.item')}</th><th className="font-semibold">{t('sc.t0')}</th><th className="font-semibold">{t('sc.t100')}</th><th className="font-semibold">{t('cfg.weight')}</th></tr></thead>
          <tbody>{items.map(([k, i]) => <tr key={k} className="border-b border-line last:border-0"><td className="py-1">{String(t(`sc.i_${i.key ?? k}`, { defaultValue: i.key ?? k }))} <span className="text-xs opacity-60">{i.basis ? (i.basis === 'initial' ? t('sc.start') : t('sc.evol')) : i.block}</span></td>{(['t0', 't100', 'weight'] as const).map(f => <td key={f}><input type="number" step="any" aria-label={`${k} ${f}`} className={inp + ' w-24'} value={i[f]} onChange={e => set(k, f, e.target.value)} /></td>)}</tr>)}</tbody></table></div>
        <div className="flex flex-wrap gap-2 mt-3"><button className="btn-ghost" onClick={() => save('a_valider')}>{t('sc.saveDraft')}</button><button className="btn" onClick={() => save('valide')}>{t('sc.saveValid')}</button></div></div>}
      <div className="card p-4 mt-3"><h3 className="text-base">{t('sc.wbTitle')}</h3><p className="text-sm max-w-3xl">{t('sc.wbHint')}</p>
        <div className="flex flex-wrap items-end gap-3 mt-2"><input type="file" accept=".xlsx" className="text-sm" onChange={e => { setFile(e.target.files?.[0] ?? null); setRes(null); }} /><button className="btn-ghost" disabled={!file} onClick={() => send(false)}>{t('adm.run')}</button><button className="btn" disabled={!file || !res || res.applied} onClick={() => send(true)}>{t('adm.apply')}</button></div>
        {res && <p className="text-sm mt-2" aria-live="polite"><strong>{res.applied ? t('fua.applied') : t('fua.preview')}</strong> — {t('sc.wbRes', { m: res.farms_matched, n: res.farms_in_file, v: res.values, i: res.indicators })}{res.unknown_farms.length > 0 && <> · {t('sc.wbUnknown')} : {res.unknown_farms.join(', ')}</>}</p>}</div>
    </section>
  );
}
