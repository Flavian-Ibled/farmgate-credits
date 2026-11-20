import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, fmt, pct } from '../api';
import { Trajectory } from '../components/Sheet';

export const FU_COLOR: Record<string, string> = { planned: '#bec9b9', diagnosed: '#DFAD0B', verified: '#529a38', audited: '#1e4414' };
export function FuBadge({ s }: { s: string }) { const { t } = useTranslation(); return <span className="badge" style={{ background: FU_COLOR[s] ?? '#ccc', color: s === 'planned' || s === 'diagnosed' ? '#1e4414' : '#fff' }}>{t(`fu.st_${s}`)}</span>; }

export default function FollowUps() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<any[] | null>(null), [open, setOpen] = useState<string | null>(null), [farms, setFarms] = useState<any[] | null>(null), [err, setErr] = useState('');
  useEffect(() => { api('/public/followups').then(setRows).catch(e => setErr(e.message)); }, []);
  const toggle = (r: any) => { const k = `${r.slug}/${r.harvest_year}`; if (open === k) return setOpen(null); setOpen(k); setFarms(null); api(`/public/followups/${k}`).then(setFarms).catch(() => setFarms([])); };
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <h1 className="text-2xl sm:text-4xl">{t('fu.title')}</h1><p className="mt-2 max-w-3xl">{t('fu.lead')}</p>
      <ul className="mt-3 flex flex-wrap gap-2 text-xs">{(['planned', 'diagnosed', 'verified', 'audited'] as const).map(s => <li key={s}><FuBadge s={s} /> <span className="opacity-80">{t(`fu.def_${s}`)}</span></li>)}</ul>
      {err && <p role="alert" className="text-red-700 mt-3">{err}</p>}
      {!rows ? <p className="mt-4">{t('loading')}</p> : rows.length === 0 ? <p className="mt-4">{t('fu.none')}</p> : rows.map(r => { const k = `${r.slug}/${r.harvest_year}`; const st = r.status.audited ? 'audited' : r.status.verified ? 'verified' : 'diagnosed'; return (
        <section key={k} className="card p-4 sm:p-5 mt-4">
          <header className="flex flex-wrap items-start gap-3"><div className="flex-1 min-w-56"><h2 className="text-lg sm:text-xl"><Link className="underline" to={`/projets/${r.slug}`}>{r.project}</Link> · R{String(r.harvest_year).slice(2)}</h2>
            <p className="text-sm mt-1">{t('p.followed', { n: r.farms_followed, t: r.farms_total })} · {t('s.lastDiag')} : {r.last_diagnostic ? new Date(r.last_diagnostic).toLocaleDateString() : t('tbd')} · {t('fu.reports')} : {r.documents || t('tbd')}</p>
            <p className="mt-1 flex flex-wrap gap-1.5 text-xs items-center"><FuBadge s={st} />{r.status.diagnosed > 0 && <span>{r.status.diagnosed} {t('fu.st_diagnosed')}</span>}{r.status.verified > 0 && <span>· {r.status.verified} {t('fu.st_verified')}</span>}{r.status.audited > 0 && <span>· {r.status.audited} {t('fu.st_audited')}</span>}</p></div>
            <button className="btn-ghost" aria-expanded={open === k} onClick={() => toggle(r)}>{open === k ? '−' : '+'} {t('fu.byFarm')}</button></header>
          <div className="mt-4 grid lg:grid-cols-2 gap-3">
            <Trajectory initial={r.labelled_of_followed} generated={r.measured} estimate={r.end_of_project_estimate} year={r.harvest_year} followed={t('p.onFollowed', { n: r.farms_followed })} />
            <dl className="text-sm">{([[t('fu.plannedYear'), `${fmt(r.planned_year)} tCO₂e`, t('fu.plannedHint')], [t('fu.measuredYear'), `${fmt(r.measured)} tCO₂e`, r.planned_year ? `${pct(r.measured / r.planned_year - 1, 0)} ${t('fu.vsPlanned')}` : ''], [t('s.avoid'), `${fmt(r.re_avoidance)} tCO₂e`, ''], [t('s.storage'), `${fmt(r.re_storage)} tCO₂e`, ''], [t('fu.gross'), r.gross_emissions_change == null ? t('tbd') : pct(r.gross_emissions_change), ''], [t('kpi.labelled'), `${fmt(r.labelled_project)} tCO₂e`, t('fu.wholeProject')]] as const).map(([a, b, c]) => <div key={a} className="flex justify-between gap-3 py-2 border-b border-line"><dt>{a}{c && <span className="block text-xs opacity-70">{c}</span>}</dt><dd className="font-bold text-soil tabular-nums text-right">{b}</dd></div>)}</dl>
          </div>
          {open === k && (!farms ? <p className="mt-3">{t('loading')}</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">{t('fu.byFarm')}</caption><thead><tr className="text-left border-b border-line">{[t('list.id'), t('f.status'), t('fu.plannedYear'), t('fu.measuredYear'), t('s.avoid'), t('s.storage'), t('p.tEstimate'), t('fu.report')].map(h => <th key={h} className="py-2 pr-3 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>{farms.map(f => <tr key={f.id} className="border-b border-line"><td className="py-1.5 pr-3 font-medium"><Link className="underline" to={`/fermes/${f.id}`}>{f.id}</Link>{f.lbc_status === 'Désengagé' && <span className="badge bg-line ml-1">Désengagé</span>}</td><td className="pr-3"><FuBadge s={f.status} /></td><td className="pr-3 tabular-nums">{fmt(f.planned_year)}</td><td className="pr-3 tabular-nums font-semibold">{fmt(f.measured)}</td><td className="pr-3 tabular-nums">{fmt(f.re_avoidance)}</td><td className="pr-3 tabular-nums">{fmt(f.re_storage)}</td><td className="pr-3 tabular-nums">{fmt(f.end_of_project_estimate)}</td><td>{f.document_url ? <a className="underline" href={f.document_url}>PDF</a> : '—'}</td></tr>)}</tbody></table></div>)}
        </section>); })}
      <p className="mt-6 text-xs opacity-75">{t('p.caution')} {t('fu.rule')}</p>
    </div>
  );
}
