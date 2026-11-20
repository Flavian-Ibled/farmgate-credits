import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, fmt } from '../api';

export default function AdminFollowups({ projects }: { projects: any[] }) {
  const { t } = useTranslation();
  const [slug, setSlug] = useState(''), [year, setYear] = useState(2025), [res, setRes] = useState<any>(null), [msg, setMsg] = useState(''), [file, setFile] = useState<File | null>(null);
  useEffect(() => { if (!slug && projects[0]) setSlug(projects.find(p => /2nd projet/.test(p.name))?.slug ?? projects[0].slug); }, [projects]);
  const send = async (apply: boolean) => { if (!file) return; setMsg(''); const fd = new FormData(); fd.set('file', file); if (apply) fd.set('apply', '1'); try { setRes(await api('/admin/followups/import', fd)); } catch (e: any) { setMsg(e.message); setRes(null); } };
  const status = async (s: string) => { try { const r = await api(`/admin/followups/${slug}/${year}/status`, { status: s }, { method: 'PUT' }); setMsg(t('fua.statusDone', { n: r.updated })); } catch (e: any) { setMsg(e.message); } };
  const inp = 'border border-line rounded px-2 py-1 text-sm bg-white';
  return (
    <section className="mt-8"><h2 className="text-xl font-bold">{t('fua.title')}</h2><p className="text-sm mt-1 max-w-3xl">{t('fua.hint')}</p>
      <div className="card p-4 mt-2 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium flex-1 min-w-56">{t('f.project')}<select className={inp + ' block w-full mt-1'} value={slug} onChange={e => setSlug(e.target.value)}>{projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label>
        <label className="text-sm font-medium">{t('fua.year')}<select className={inp + ' block mt-1'} value={year} onChange={e => setYear(Number(e.target.value))}>{[2025, 2026, 2027, 2028, 2029, 2030, 2031].map(y => <option key={y} value={y}>R{String(y).slice(2)} ({y})</option>)}</select></label>
        <a className="btn-ghost" href={`/api/admin/followups/${slug}/${year}/sheet.xlsx`}>↓ {t('fua.sheet')}</a>
        <span className="text-sm">{t('fua.setStatus')} :</span>{(['diagnosed', 'verified', 'audited'] as const).map(s => <button key={s} className="btn-ghost" onClick={() => { if (confirm(t('fua.confirm', { s: t(`fu.st_${s}`) }))) status(s); }}>{t(`fu.st_${s}`)}</button>)}
      </div>
      <div className="card p-4 mt-2 flex flex-wrap items-end gap-3"><label className="text-sm font-medium flex-1">{t('fua.upload')}<input type="file" accept=".xlsx" className="mt-1 block w-full text-sm" onChange={e => { setFile(e.target.files?.[0] ?? null); setRes(null); }} /></label>
        <button className="btn-ghost" disabled={!file} onClick={() => send(false)}>{t('adm.run')}</button><button className="btn" disabled={!file || !res || res.applied} onClick={() => send(true)}>{t('adm.apply')}</button></div>
      {msg && <p role="status" className="mt-2 text-sm font-medium">{msg}</p>}
      {res && <div className="card p-4 mt-2 text-sm" aria-live="polite"><strong>{res.applied ? t('fua.applied') : t('fua.preview')}</strong> — {fmt(res.created)} {t('adm.created')} · {fmt(res.updated)} {t('adm.updated')} · {fmt(res.unchanged)} {t('adm.unchanged')} · {fmt(res.errors.length)} {t('adm.errors')}
        {res.errors.length > 0 && <ul className="mt-2 max-h-40 overflow-auto text-xs">{res.errors.slice(0, 100).map((e: any, i: number) => <li key={i}>L{e.row} {e.farm_id ?? ''} — {e.message}</li>)}</ul>}</div>}
    </section>
  );
}
