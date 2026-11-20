// Public impact & transparency dashboard (aggregated data only). Every figure says where it comes from and how reliable it is.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, fmt, pct, share } from '../api';
import { Pie, Tile, Trajectory } from '../components/Sheet';
import { IndIcon, CatIcon } from '../components/Icons';
import { TREND } from './FarmPage';

export const useTr = () => { const { i18n } = useTranslation(); return (fr: string, en: string) => (i18n.language === 'en' ? en : fr); };
export const Stamp = ({ asOf, source }: { asOf: string | null; source: string }) => { const tr = useTr(); return <p className="text-xs opacity-75 flex flex-wrap gap-x-3 gap-y-1"><span>{tr('Source', 'Source')} : {source}</span><span>{tr('données au', 'data as of')} {asOf ? new Date(asOf).toLocaleDateString(tr('fr-FR', 'en-GB')) : '—'}</span></p>; };

export default function Impact() {
  const { t, i18n } = useTranslation(); const tr = useTr(); const en = i18n.language === 'en'; const [d, setD] = useState<any>(null), [err, setErr] = useState('');
  useEffect(() => { api('/public/impact').then(setD).catch(e => setErr(e.message)); document.title = `${tr('Impact et transparence', 'Impact and transparency')} — Farmgate Credits`; }, [i18n.language]);
  if (err) return <p role="alert" className="p-8 text-red-700">{err}</p>; if (!d) return <p className="p-8">{t('loading')}</p>;
  const c = d.carbon, f = c.followup;
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <p className="text-xs font-bold uppercase tracking-widest text-leaf-dark">{tr('Tableau de bord public', 'Public dashboard')}</p>
      <h1 className="mt-1 text-3xl sm:text-5xl">{tr('Impact et transparence', 'Impact and transparency')}</h1>
      <p className="mt-3 max-w-3xl">{tr('Ce que finance le portefeuille de Carbone Farmers : le carbone évité et stocké, ce qui est déjà financé, ce qui est mesuré, et les co-bénéfices. Chaque chiffre indique sa source et son niveau de fiabilité.', 'What Carbone Farmers’ portfolio finances: carbon avoided and stored, what is already funded, what is measured, and the co-benefits. Every figure states its source and reliability.')}</p>
      <div className="mt-2"><Stamp asOf={d.data_as_of} source={d.source} /></div>

      <section className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label={t('p.key')}>
        <Tile value={fmt(d.scale.farms)} label={t('kpi.farms')} sub={`${d.scale.projects} ${t('s.projects')} · ${d.scale.regions} ${t('s.regions')}`} />
        <Tile tone="apple" value={fmt(d.scale.sau)} label={t('kpi.sau')} />
        <Tile value={fmt(c.re_labelled)} label={t('kpi.labelled')} sub={`${t('status.estimated')} — ${t('p.caution')}`} />
        <Tile tone="brown" value={c.funded_pct != null ? share(c.funded_pct) : '—'} label={tr('des crédits vendables financés', 'of sellable credits funded')} sub={`${fmt(c.available)} tCO₂e ${t('fp2.stillAvail')}`} />
      </section>

      <section className="mt-3 grid lg:grid-cols-2 gap-3">
        {f ? <Trajectory initial={f.labelled_of_followed} generated={f.measured} estimate={f.end_of_project_estimate} year={f.year} followed={t('p.onFollowed', { n: f.farms })} formula={tr('évitement × 5 + stockage × 15 (projection sur les fermes suivies, règle à confirmer)', 'avoidance × 5 + storage × 15 (projection on followed farms, rule to be confirmed)')} /> : <div className="card p-5"><h2 className="text-base">{t('p.trajectory')}</h2><p className="text-sm mt-2">{t('p.noFollowup')}</p></div>}
        <div className="card p-4 sm:p-5"><h2 className="text-base">{tr('Évitement et stockage', 'Avoidance and storage')}</h2>
          {c.avoidance != null && c.storage != null && c.avoidance >= 0 && c.storage >= 0 ? <div className="mt-3"><Pie avoid={c.avoidance} store={c.storage} caption={`${tr('Crédits labellisés sur 5 ans', 'Labelled credits over 5 years')} · ${t('s.nData', { n: c.n_with_split })} / ${d.scale.farms}`} /></div> : <p className="mt-2 text-sm">{t('p.noSplit')}</p>}
          <h3 className="text-sm mt-4">{tr('Statut des fermes', 'Farm status')}</h3><ul className="mt-1 flex flex-wrap gap-1.5">{d.scale.statuses.map((s: any) => <li key={s.key} className="badge bg-mist">{s.key} · {fmt(s.farms)}</li>)}</ul>
          <h3 className="text-sm mt-3">{tr('Régions', 'Regions')}</h3><p className="text-sm">{d.scale.regions_list.map((r: any) => `${r.key} (${r.farms})`).join(' · ')}</p></div>
      </section>

      <section className="mt-8"><h2 className="text-xl sm:text-2xl">{tr('Les projets', 'The projects')}</h2>
        <div className="card mt-2 overflow-x-auto"><table className="w-full text-sm"><caption className="sr-only">{tr('Les projets', 'The projects')}</caption><thead><tr className="text-left border-b border-line">{[t('f.project'), t('kpi.farms'), 'SAU (ha)', t('kpi.labelled'), t('ow.funded'), t('kpi.measured')].map(h => <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>{d.projects.map((p: any) => <tr key={p.name} className="border-b border-line last:border-0"><td className="px-3 py-1.5 font-medium">{p.slug ? <Link className="underline" to={`/projets/${p.slug}`}>{p.name}</Link> : p.name}{p.porteur && <span className="block text-xs opacity-70 font-normal">{p.porteur}</span>}</td><td className="px-3 tabular-nums">{fmt(p.farms)}</td><td className="px-3 tabular-nums">{fmt(p.sau)}</td><td className="px-3 tabular-nums">{fmt(p.re_labelled)}</td>
            <td className="px-3 whitespace-nowrap">{p.funded_pct != null ? <span className="inline-flex items-center gap-1.5"><span className="inline-block w-14 h-2 rounded bg-line overflow-hidden"><span className="block h-2 bg-apple" style={{ width: `${p.funded_pct * 100}%` }} /></span><span className="tabular-nums">{share(p.funded_pct)}</span></span> : '—'}</td><td className="px-3 tabular-nums">{p.followed ? `${fmt(p.measured)} (${p.followed})` : '—'}</td></tr>)}</tbody></table></div></section>

      <section className="mt-8"><div className="flex flex-wrap items-end justify-between gap-2"><h2 className="text-xl sm:text-2xl">{t('s.cob')}</h2><span className="text-xs opacity-75">{t('fp3.cobShown', { n: d.cobenefits_count.shown, t: d.cobenefits_count.tracked })}</span></div>
        <p className="text-xs opacity-75 mt-1">{t('s.relNote')}</p>
        {d.cobenefits.length === 0 ? <p className="mt-2 text-sm">{t('s.notCollected')}</p> : <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">{d.cobenefits.map((x: any) => { const sh = x.unit === 'part de SAU'; const v = (n: number | null) => (n == null ? '—' : sh ? share(n, 0) : fmt(n, Math.abs(n) < 100 ? 1 : 0));
          return <div key={x.code} className="rounded-2xl bg-mist p-3"><div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-leaf-dark"><CatIcon cat={x.category} size={22} />{x.category}</div><div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: TREND[(x.trend ?? 'same') as keyof typeof TREND] }}>{pct(x.evolution)}</div><div className="text-xs mt-0.5 flex items-center gap-1"><IndIcon code={x.code} size={18} />{en ? x.label_en : x.label_fr}</div><div className="text-[11px] opacity-75">{v(x.initial)} → {v(x.prospectif)}{sh ? '' : ` ${x.unit}`}</div><span className="badge bg-wheat/30 mt-1">{t('s.coverage', { n: x.n_with_data, t: x.n_applicable })}</span></div>; })}</div>}</section>

      {d.funders.length > 0 && <section className="mt-8"><h2 className="text-xl sm:text-2xl">{tr('Ils financent', 'Funders')}</h2><ul className="mt-2 flex flex-wrap gap-2">{d.funders.map((x: any) => <li key={x.public_slug}><Link className="card px-4 py-2 block font-bold text-soil hover:border-leaf" to={`/contribution/${x.public_slug}`}>{x.name}</Link></li>)}</ul></section>}

      <section className="mt-10 grid sm:grid-cols-3 gap-3">{[['/methodologie', tr('Comment sont calculés ces chiffres ?', 'How are these figures calculated?'), tr('Méthodologie', 'Methodology')], ['/donnees', tr('Télécharger les données', 'Download the data'), tr('Données ouvertes', 'Open data')], ['/carte', tr('Explorer les fermes', 'Explore the farms'), tr('Carte', 'Map')]].map(([to, a, b]) => <Link key={to} to={to} className="card p-4 block hover:border-leaf"><div className="text-xs font-bold uppercase tracking-widest text-leaf-dark">{b}</div><div className="font-bold text-soil mt-1">{a} →</div></Link>)}</section>
    </div>
  );
}
