import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, fmt } from '../api';
import AdminConfig from './AdminConfig';
import AdminFollowups from './AdminFollowups';
import AdminFarmSheet from './AdminFarmSheet';
import AdminLivrable from './AdminLivrable';
import AdminFunders from './AdminFunders';
import AdminVisibility from './AdminVisibility';
import AdminMoney from './AdminMoney';
import AdminScores from './AdminScores';
import AdminExtras from './AdminExtras';
import { AdminOrders } from './Shop';

export default function Admin() {
  const { t } = useTranslation();
  const [me, setMe] = useState<any>(undefined), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const [imports, setImports] = useState<any[]>([]), [detail, setDetail] = useState<any>(null), [points, setPoints] = useState<any[]>([]), [projects, setProjects] = useState<any[]>([]);
  const load = () => { api('/admin/imports').then(setImports).catch(() => {}); api('/admin/projects').then(setProjects).catch(() => {}); api('/admin/open-points').then(setPoints).catch(() => {}); };
  useEffect(() => { api('/auth/me').then(m => { setMe(m); if (m) load(); }).catch(() => setMe(null)); }, []);
  const run = async (fn: () => Promise<any>) => { setBusy(true); setErr(''); try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };

  if (me === undefined) return <p className="p-8">{t('loading')}</p>;
  if (!me) return (
    <form className="mx-auto max-w-sm card p-6 mt-16" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(async () => { await api('/auth/login', { email: f.get('email'), password: f.get('password') }); setMe(await api('/auth/me')); load(); }); }}>
      <h1 className="text-2xl font-bold">{t('adm.login')}</h1>
      <label className="block mt-4 text-sm font-medium">{t('adm.email')}<input name="email" type="email" required autoComplete="username" className="mt-1 w-full border border-line rounded px-3 py-2" /></label>
      <label className="block mt-3 text-sm font-medium">{t('adm.password')}<input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full border border-line rounded px-3 py-2" /></label>
      {err && <p role="alert" className="mt-3 text-sm text-red-700">{err}</p>}
      <button className="btn mt-4 w-full" disabled={busy}>{t('adm.signin')}</button>
    </form>);
  const c = detail?.counts, rep = detail?.report;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-center gap-3"><h1 className="text-3xl font-bold mr-auto">{t('adm.imports')}</h1><span className="text-sm">{me.email} · {me.role}</span><button className="btn-ghost" onClick={() => run(async () => { await api('/auth/logout', {}); setMe(null); })}>{t('adm.signout')}</button></div>
      {err && <p role="alert" className="mt-3 text-sm text-red-700">{err}</p>}
      <form className="card p-4 mt-4 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(async () => { const r = await api('/admin/imports', fd); load(); setDetail(await api(`/admin/imports/${r.id}`)); }); }}>
        <label className="text-sm font-medium flex-1">{t('adm.upload')}<input name="file" type="file" accept=".xlsx" required className="mt-1 block w-full text-sm" /></label>
        <label className="text-sm font-medium">{t('adm.sheetName')}<input name="sheet" type="text" className="mt-1 block border border-line rounded px-2 py-1 text-sm w-40" placeholder="CVL2" /></label>
        <button className="btn" disabled={busy}>{busy ? t('loading') : t('adm.run')}</button>
      </form>

      {detail && (<section className="card p-4 mt-4" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold mr-auto">#{detail.id} · {detail.filename} · <span className="badge bg-wheat/40">{detail.status}</span></h2>
          {rep?.scope && <span className="badge bg-mist">{rep.scope.type === 'full' ? t('adm.scopeFull') : `${t('adm.scopeProject')} : ${rep.scope.projects.join(', ')}`}</span>}
          <a className="btn-ghost" href={`/api/admin/imports/${detail.id}/issues.xlsx`}>{t('adm.report')}</a>
          {detail.status === 'dry_run' && <button className="btn" disabled={busy} onClick={() => run(async () => { await api(`/admin/imports/${detail.id}/apply`, {}); load(); setDetail(await api(`/admin/imports/${detail.id}`)); })}>{t('adm.apply')}</button>}
          {detail.status === 'applied' && <button className="btn-ghost" disabled={busy} onClick={() => { if (confirm(t('adm.rollback') + ' ?')) run(async () => { await api(`/admin/imports/${detail.id}/rollback`, {}); load(); setDetail(await api(`/admin/imports/${detail.id}`)); }); }}>{t('adm.rollback')}</button>}</div>
        {rep?.fatal && <p role="alert" className="text-red-700 mt-2">{rep.fatal}</p>}
        {c && <dl className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2 text-center">{(['created', 'updated', 'unchanged', 'absent', 'errors', 'warnings'] as const).map(k => <div key={k} className="bg-cream rounded-lg p-2"><dd className="text-2xl font-bold text-soil tabular-nums">{fmt(c[k])}</dd><dt className="text-xs">{t(`adm.${k}`)}</dt></div>)}</dl>}
        {rep?.stats?.cvl2_gap && <p className="mt-3 text-sm bg-wheat/20 rounded p-2">CVL2 — Master List : {rep.stats.cvl2_gap.master.farms} fermes / {fmt(rep.stats.cvl2_gap.master.re_labelled)} tCO₂e · feuille CVL2 : {rep.stats.cvl2_gap.sheet.farms} / {fmt(rep.stats.cvl2_gap.sheet.re_labelled)} ({rep.stats.cvl2_gap.sheet.followed} suivies) · fiche projet : 112 / 68 339 (109 suivies)</p>}
        {rep?.by_code && (<><h3 className="mt-4 font-bold">{t('adm.issues')}</h3><ul className="mt-1 text-sm grid sm:grid-cols-2 gap-x-6">{Object.entries(rep.by_code).map(([k, v]: any) => <li key={k} className="flex justify-between border-b border-line py-1"><span><span className={`badge mr-2 ${v.level === 'error' ? 'bg-red-100 text-red-800' : v.level === 'warning' ? 'bg-wheat/40' : 'bg-line'}`}>{v.level}</span>{k}</span><span className="tabular-nums">{v.n}</span></li>)}</ul></>)}
        {rep?.diff?.updated?.length > 0 && (<><h3 className="mt-4 font-bold">{t('adm.diff')} ({rep.diff.updated_total})</h3><div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left"><th>id</th><th>champ</th><th>{t('adm.before')}</th><th>{t('adm.after')}</th></tr></thead><tbody>{rep.diff.updated.flatMap((u: any) => u.changes.map((ch: any, i: number) => <tr key={u.id + ch.field} className="border-t border-line"><td>{i === 0 ? u.id : ''}</td><td>{ch.field}</td><td>{String(ch.old ?? '∅')}</td><td>{String(ch.new ?? '∅')}</td></tr>))}</tbody></table></div></>)}
        {rep?.diff?.absent?.length > 0 && <p className="mt-3 text-sm">{t('adm.absent')} : {rep.diff.absent.slice(0, 40).join(', ')}</p>}
      </section>)}

      <h2 className="text-xl font-bold mt-8">{t('adm.projects')}</h2>
      <p className="text-sm mt-1 max-w-3xl">{t('adm.sheetHint')}</p>
      <div className="card mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b border-line">{[t('f.project'), t('f.porteur'), t('kpi.farms'), t('adm.withdrawn'), t('adm.absent'), t('adm.lastDiag'), t('adm.verified'), ''].map((h, i) => <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{projects.map(p => <tr key={p.id} className="border-b border-line last:border-0"><td className="px-3 py-1.5 font-medium">{p.name}</td><td className="px-3">{p.porteur ?? <span className="opacity-60">{t('tbd')}</span>}</td><td className="px-3 tabular-nums">{p.farms}</td><td className="px-3 tabular-nums">{p.withdrawn}</td><td className="px-3 tabular-nums">{p.absent}</td><td className="px-3">{p.last_diag ? new Date(p.last_diag).toLocaleDateString() : <span className="opacity-60">{t('tbd')}</span>}</td><td className="px-3 tabular-nums">{p.verified} / {p.farms}</td><td className="px-3 py-1.5 text-right"><a className="btn-ghost whitespace-nowrap" href={`/api/admin/projects/${p.id}/sheet.xlsx`}>↓ {t('adm.sheet')}</a></td></tr>)}
          <tr><td colSpan={7} className="px-3 py-2 font-medium">{t('adm.all')}</td><td className="px-3 py-2 text-right"><a className="btn-ghost whitespace-nowrap" href="/api/admin/projects/all/sheet.xlsx">↓ {t('adm.sheet')}</a></td></tr></tbody></table></div>

      <h2 className="text-xl font-bold mt-8">{t('adm.history')}</h2>
      {imports.length === 0 ? <p className="text-sm mt-2">{t('adm.none')}</p> : <ul className="mt-2 card divide-y divide-line">{imports.map(i => <li key={i.id}><button className="w-full text-left px-4 py-2 text-sm hover:bg-cream flex flex-wrap gap-3" onClick={() => run(async () => setDetail(await api(`/admin/imports/${i.id}`)))}><strong>#{i.id}</strong><span>{i.filename}</span><span className="badge bg-wheat/40">{i.status}</span><span className="ml-auto opacity-70">{new Date(i.created_at).toLocaleString()}</span></button></li>)}</ul>}

      <AdminOrders projects={projects} />
      <AdminFunders projects={projects} />
      <AdminFollowups projects={projects} />
      <AdminExtras projects={projects} />
      <AdminScores />
      <AdminMoney projects={projects} />
      <AdminVisibility projects={projects} />
      <AdminLivrable projects={projects} />
      <AdminFarmSheet />
      <AdminConfig />

      <h2 className="text-xl font-bold mt-8">{t('adm.open')}</h2>
      <ul className="mt-2 grid md:grid-cols-2 gap-3">{points.map(p => <li key={p.id} className="card p-4"><div className="flex gap-2 items-start"><span className="badge bg-wheat/50 shrink-0">à valider</span><h3 className="font-bold font-sans">{p.id}. {p.title}</h3></div><p className="text-sm mt-1">{p.detail}</p><p className="text-xs mt-2 opacity-75">{t('adm.owner')} : {p.owner} · {t('adm.phase')} {p.blocks_phase}</p></li>)}</ul>
    </div>
  );
}
