// Admin: porteurs (invitations), Excel templates and imports for crops and lever costs, bulk assignment of historical sales.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, fmt } from '../api';

const inp = 'border border-line rounded px-2 py-1 text-sm bg-white';
export default function AdminExtras({ projects }: { projects: any[] }) {
  const { t } = useTranslation(); const [owners, setOwners] = useState<any[]>([]), [funders, setFunders] = useState<any[]>([]), [slug, setSlug] = useState(''), [kind, setKind] = useState('crops'), [file, setFile] = useState<File | null>(null), [res, setRes] = useState<any>(null), [msg, setMsg] = useState(''), [link, setLink] = useState('');
  const load = () => { api('/admin/owners').then(setOwners).catch(() => {}); api('/admin/funders').then(setFunders).catch(() => {}); }; useEffect(load, []);
  useEffect(() => { if (!slug && projects[0]) setSlug(projects[0].slug); }, [projects]);
  const send = async (apply: boolean) => { if (!file) return; setMsg(''); const fd = new FormData(); fd.set('file', file); if (apply) fd.set('apply', '1'); try { setRes(await api(`/admin/imports/${kind}`, fd)); } catch (e: any) { setMsg(e.message); setRes(null); } };
  return (
    <section className="mt-8"><h2 className="text-xl font-bold">{t('ex.title')}</h2>{msg && <p role="status" className="mt-2 text-sm font-medium">{msg}</p>}
      <h3 className="text-base mt-3">{t('ex.imports')}</h3><p className="text-sm max-w-3xl">{t('ex.importsHint')}</p>
      <div className="card p-4 mt-1 flex flex-wrap items-end gap-3"><label className="text-xs font-medium">{t('ex.kind')}<select className={inp + ' block mt-1'} value={kind} onChange={e => { setKind(e.target.value); setRes(null); }}><option value="crops">{t('fp.crops')}</option><option value="lever-costs">{t('mo.leverCosts')}</option></select></label>
        <label className="text-xs font-medium flex-1 min-w-48">{t('f.project')}<select className={inp + ' block mt-1 w-full'} value={slug} onChange={e => setSlug(e.target.value)}>{projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label>
        <a className="btn-ghost" href={`/api/admin/templates/${kind}/${slug}`}>↓ {t('ex.template')}</a><input type="file" accept=".xlsx" className="text-sm" onChange={e => { setFile(e.target.files?.[0] ?? null); setRes(null); }} /><button className="btn-ghost" disabled={!file} onClick={() => send(false)}>{t('adm.run')}</button><button className="btn" disabled={!file || !res || res.applied} onClick={() => send(true)}>{t('adm.apply')}</button></div>
      {res && <div className="card p-3 mt-2 text-sm" aria-live="polite"><strong>{res.applied ? t('fua.applied') : t('fua.preview')}</strong> — {fmt(res.rows)} {t('ex.rows')} · {fmt(res.farms)} {t('kpi.farms')} · {fmt(res.errors.length)} {t('adm.errors')}{res.errors.length > 0 && <ul className="mt-1 text-xs max-h-32 overflow-auto">{res.errors.slice(0, 80).map((e: any, i: number) => <li key={i}>L{e.row} — {e.message}</li>)}</ul>}</div>}

      <h3 className="text-base mt-5">{t('ex.owners')}</h3><p className="text-sm max-w-3xl">{t('ex.ownersHint')}</p>
      <div className="card mt-1 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b border-line">{[t('f.porteur'), t('home.projects'), t('af.users'), t('af.invite')].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead><tbody>{owners.length === 0 && <tr><td colSpan={4} className="px-3 py-3">{t('ex.noOwner')}</td></tr>}{owners.map(o => <tr key={o.id} className="border-b border-line last:border-0"><td className="px-3 py-1.5 font-medium">{o.name}</td><td className="px-3 text-xs">{o.projects ?? '—'}</td><td className="px-3 tabular-nums">{o.users}</td><td className="px-3 py-1.5"><form className="flex gap-1" onSubmit={async e => { e.preventDefault(); setMsg(''); try { const r = await api(`/admin/funders/${o.id}/invitations`, { email: new FormData(e.currentTarget).get('email') }); setLink(location.origin + r.link); load(); } catch (x: any) { setMsg(x.message); } }}><input name="email" type="email" required placeholder="e-mail" aria-label="e-mail" className={inp + ' w-48'} /><button className="btn-ghost">{t('af.send')}</button></form></td></tr>)}</tbody></table></div>
      {link && <p className="mt-2 text-sm bg-mist rounded p-2 break-all">{t('af.linkHint')} <strong>{link}</strong></p>}

      <h3 className="text-base mt-5">{t('ex.bulk')}</h3><p className="text-sm max-w-3xl">{t('ex.bulkHint')}</p>
      <form className="card p-4 mt-1 flex flex-wrap items-end gap-3" onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); setMsg(''); if (!confirm(t('ex.bulkConfirm'))) return; try { const r = await api(`/admin/projects/${f.get('slug')}/historical-funder`, { funder_org_id: f.get('org') }, { method: 'PUT' }); setMsg(t('ex.bulkDone', { n: r.updated })); } catch (x: any) { setMsg(x.message); } }}>
        <label className="text-xs font-medium flex-1 min-w-48">{t('f.project')}<select name="slug" className={inp + ' block mt-1 w-full'}>{projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label><label className="text-xs font-medium">{t('af.org')}<select name="org" className={inp + ' block mt-1'} required>{funders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label><button className="btn" disabled={!funders.length}>{t('ex.bulkGo')}</button></form>
    </section>
  );
}
