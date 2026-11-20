import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, fmt, share, STATUS_COLOR } from '../api';
import { BuyButton } from './Shop';
import { MoneyFlow, Pie, Tile, Tbd, Trajectory, Scorecards, Scale, SheetFooter, PdfButton, isPrint } from '../components/Sheet';

const isTbd = (v: any) => v && typeof v === 'object' && !Array.isArray(v) && 'owner' in v && v.value === null;
function Auto({ k, v }: { k: string; v: any }) {
  const { t } = useTranslation(); const label = t(`b.f.${k}`, k.replace(/_/g, ' '));
  let val: any;
  if (isTbd(v)) val = <Tbd owner={v.owner} />;
  else if (v == null) val = <Tbd />;
  else if (Array.isArray(v)) val = v.length === 0 ? <Tbd /> : typeof v[0] === 'string' ? v.join(' · ') : 'key' in v[0] ? v.map((x: any) => `${x.key} (${x.farms})`).join(' · ') : 'harvest_year' in v[0] ? v.map((x: any) => `R${String(x.harvest_year).slice(2)} : ${fmt(x.measured)} tCO₂e (${x.farms_followed} fermes)`).join(' · ') : v.map((x: any) => `${x.value} (${x.farms})`).join(' · ');
  else if (typeof v === 'object') val = v.value == null ? <Tbd /> : <>{fmt(v.value, 2)} tCO₂e/ha <span className="opacity-60 text-xs">n = {v.n_with_data}</span></>;
  else val = typeof v === 'number' ? fmt(v) : String(v);
  return <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-1.5 border-b border-line last:border-0 text-sm"><dt className="opacity-80">{label}</dt><dd className="font-medium text-right max-w-[70%]">{val}</dd></div>;
}

export default function ProjectPage() {
  const { slug } = useParams(); const { t } = useTranslation();
  const [d, setD] = useState<any>(null), [err, setErr] = useState(''), [farms, setFarms] = useState<any>(null), [page, setPage] = useState(1);
  const print = isPrint();
  useEffect(() => { setD(null); api(`/public/projects/${slug}`).then(setD).catch(e => setErr(e.message)); }, [slug]);
  useEffect(() => { if (d) api('/public/farms', { filters: { project: [d.project.name] }, page, size: print ? 100 : 24 }).then(setFarms).catch(() => {}); }, [d, page]);
  useEffect(() => { if (d) document.title = `${d.project.name} — Farmgate Credits`; }, [d]);
  if (err) return <p role="alert" className="p-8 text-red-700">{err}</p>;
  if (!d) return <p className="p-8">{t('loading')}</p>;
  const c = d.selection.carbon, sc = d.selection.scale, fu = d.followup;
  const lv = d.selection.levers; const top = lv.items.filter((i: any) => i.farms > 0).sort((a: any, b: any) => b.share_farms - a.share_farms);
  return (
    <article className="mx-auto max-w-6xl px-4 py-6 sm:py-10 print:py-2 print:px-0">
      <nav className="text-sm print:hidden"><Link to="/" className="underline">{t('nav.home')}</Link> / {t('home.projects')}</nav>
      <header className="mt-3 flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-64"><p className="text-xs font-bold uppercase tracking-widest text-leaf-dark">{t('p.collective')} · Label Bas Carbone</p>
          <h1 className="mt-1 text-2xl sm:text-4xl">{d.project.name}</h1>
          <p className="mt-2 text-sm">{t('f.porteur')} : {d.project.porteur ?? <Tbd owner="Carbone Farmers" />} · {t('p.mandatary')}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">{sc.statuses.map((s: any) => <li key={s.key} className="badge text-white" style={{ background: STATUS_COLOR[s.key] ?? '#888' }}>{s.key} · {s.farms}</li>)}</ul></div>
        <div className="flex gap-2 print:hidden"><BuyButton type="project" id={slug!} /><Link className="btn-ghost" to={`/carte?f=${encodeURIComponent(JSON.stringify({ project: [d.project.name] }))}`}>{t('p.onMap')}</Link><PdfButton path={`/projets/${slug}`} /></div>
      </header>

      <section className="mt-6 grid grid-cols-2 lg:grid-cols-4 print:grid-cols-4 gap-3" aria-label={t('p.key')}>
        <Tile value={fmt(c.re_labelled_5y)} label={t('kpi.labelled')} sub={`${t('s.labelledDefault')} · ${t('status.estimated')}`} />
        <Tile tone="apple" value={fu ? fmt(fu.re_total) : '—'} label={t('kpi.measured')} sub={fu ? t('p.followed', { n: fu.farms_followed, t: fu.farms_total }) : t('p.noFollowup')} />
        <Tile tone="brown" value={fmt(sc.farms)} label={t('kpi.farms')} sub={`${fmt(sc.sau)} ha`} />
        <Tile tone="brown" value={fmt(d.funding?.remaining ?? c.vol_dispo)} label={t('kpi.available')} sub={d.funding?.funded_pct != null ? `${share(d.funding.funded_pct)} ${t('sl.fundedLine')}${d.funding.funders.length ? ` · ${d.funding.funders.join(', ')}` : ''}` : `${fmt(c.vol_vendu)} ${t('kpi.sold')}`} />
      </section>

      <section className="mt-6 grid lg:grid-cols-2 print:grid-cols-2 gap-3">
        <Trajectory initial={fu ? fu.labelled_of_followed : c.re_labelled_5y} generated={fu?.re_total ?? null} estimate={fu?.end_of_project_estimate ?? null} year={fu?.harvest_year} followed={fu ? t('p.onFollowed', { n: fu.farms_followed }) : undefined} formula={fu?.formula} />
        <div className="card p-4 sm:p-5 break-inside-avoid"><h2 className="text-base">{t('s.split')}</h2>
          {c.n_with_split && c.re_avoidance_5y >= 0 && c.re_storage_5y >= 0 ? <div className="mt-3"><Pie avoid={c.re_avoidance_5y} store={c.re_storage_5y} caption={`${t('fp3.pieLab')} · ${t('s.nData', { n: c.n_with_split })} / ${sc.farms}`} /></div> : fu && fu.re_avoidance >= 0 && fu.re_storage >= 0 && fu.re_total > 0 ? <div className="mt-3"><Pie avoid={fu.re_avoidance} store={fu.re_storage} caption={t('fp3.pieMeas', { y: fu.harvest_year })} /><p className="text-[11px] opacity-70 mt-1">{t('p.noSplit')}</p></div> : <p className="mt-2 text-sm"><Tbd owner="Équipe data" /> {t('p.noSplit')}</p>}
          <h2 className="text-base mt-5">{t('p.topLevers')}</h2>
          {lv.n_with_data ? <ul className="mt-2">{top.slice(0, print ? 6 : 8).map((i: any) => <li key={i.code} className="py-1 text-sm"><div className="flex justify-between gap-2"><span>{d.levers.find((l: any) => l.code === i.code)?.name_fr}</span><span className="tabular-nums shrink-0">{share(i.share_farms)}</span></div><div className="h-1.5 bg-mist rounded"><div className="h-1.5 bg-apple rounded" style={{ width: `${i.share_farms * 100}%` }} /></div></li>)}<li className="text-[11px] opacity-70 mt-1">{t('s.leverCov', { n: lv.n_with_data, t: sc.farms })}</li></ul> : <p className="mt-2 text-sm"><Tbd owner="Équipe data" /></p>}
        </div>
      </section>

      <section className="mt-8"><h2 className="text-xl sm:text-2xl">{t('b.title')}</h2><p className="text-sm mt-1 max-w-3xl">{t('b.lead')}</p>
        <div className="mt-3 grid md:grid-cols-2 print:grid-cols-2 gap-3">
          {d.blocks.map((b: any, i: number) => (
            <section key={b.key} className="card p-4 break-inside-avoid"><h3 className="text-base flex gap-2"><span className="w-6 h-6 shrink-0 rounded-full bg-soil text-white text-xs flex items-center justify-center">{i + 1}</span>{t(`b.${b.key}`)}</h3>
              <dl className="mt-2">{Object.entries(b.auto).map(([k, v]) => <Auto key={k} k={k} v={v} />)}</dl>
              {b.text ? <><p className="mt-3 text-sm whitespace-pre-line">{b.text.content}</p><p className="mt-2 text-[11px] opacity-70">{t('source')} : {b.text.source ?? '—'} · {t('b.updated')} {b.text.updated_at} · {t('b.verifiedBy')} {b.text.verified_by ?? '—'}</p></> : <p className="mt-2 text-[11px] opacity-70">{t('source')} : {d.data_source} · {t('b.noText')}</p>}
            </section>))}
        </div>
      </section>

      <section className="mt-8 grid lg:grid-cols-2 print:grid-cols-2 gap-3">
        <div className="card p-4 sm:p-5 break-inside-avoid"><h2 className="text-base">{t('mo.where')}</h2><p className="mt-1"><span className="text-3xl font-bold text-soil tabular-nums">{fmt(d.remuneration.farmer_pct, d.remuneration.farmer_pct % 1 ? 1 : 0)} %</span> <span className="text-sm">{t('mo.farmerShare')}{d.remuneration.source === 'default' ? ` · ${t('mo.minimum')}` : ''}{d.remuneration.advice_pct > 0 ? ` · ${t('mo.inclAdvice', { p: fmt(d.remuneration.advice_pct, 1) })}` : ''}</span></p><div className="mt-2"><MoneyFlow r={d.remuneration} /></div>
          <h3 className="text-sm mt-3">{t('mo.costs')}</h3>{d.lever_costs.farms_with_data ? <p className="text-sm">{t('mo.costLine', { c: fmt(d.lever_costs.cost_annual_eur_ha, 1), s: fmt(d.lever_costs.saving_eur_ha, 1), n: fmt(d.lever_costs.cost_annual_eur_ha - d.lever_costs.saving_eur_ha, 1) })}<span className="block text-[11px] opacity-75">{t('mo.costCov', { n: d.lever_costs.farms_with_data, t: d.lever_costs.farms_total })}</span></p> : <p className="text-sm"><Tbd owner="Agronomes" /> {t('mo.costTbd')}</p>}</div>
        <div className="card p-4 sm:p-5 break-inside-avoid"><h2 className="text-base">{t('so.title')}</h2><dl className="mt-2">{d.social.map((x: any) => <div key={x.key} className="py-1.5 border-b border-line last:border-0 text-sm"><dt className="font-bold text-soil">{t(`so.${x.key}`)}</dt><dd>{x.value ?? <Tbd owner="Carbone Farmers" />}</dd></div>)}</dl>{d.social_meta && <p className="text-[11px] opacity-70 mt-2">{t('source')} : {d.social_meta.source ?? '—'} · {t('b.updated')} {d.social_meta.updated_at} · {t('b.verifiedBy')} {d.social_meta.verified_by ?? '—'}</p>}</div>
      </section>

      <section className="mt-8"><div className="flex flex-wrap items-end justify-between gap-2"><h2 className="text-xl sm:text-2xl">{t('s.cob')}</h2><Scale /></div>{(d.scores.eau || d.scores.bio) && <p className="text-sm mt-2">{d.scores.eau && <><strong>{t('rk.eau')} : {fmt(d.scores.eau.mean, 0)} /100</strong> <span className="opacity-75">({t('rk.meanProject', { n: d.scores.eau.farms })})</span></>} <Link className="underline ml-2 print:hidden" to={`/selection?f=${encodeURIComponent(JSON.stringify({ project: [d.project.name] }))}`}>{t('rk.rank')} →</Link></p>}
        <p className="text-xs opacity-75 mt-1 mb-3">{t('fp3.cobShown', { n: d.cobenefits.shown, t: d.cobenefits.tracked })} {t('s.relNote')} {t('p.thresholdNote')}</p><Scorecards cards={d.scorecards} /></section>

      <section className="mt-8 print:hidden"><h2 className="text-xl sm:text-2xl">{t('p.farms')} ({sc.farms})</h2>
        {farms && <><ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">{farms.rows.map((f: any) => <li key={f.id}><Link to={`/fermes/${f.id}`} className="card p-3 block hover:border-leaf"><div className="font-bold text-soil">{f.id}</div><div className="text-xs">{f.departement ?? '—'} · {fmt(f.sau)} ha</div><div className="text-xs tabular-nums">{fmt(f.re_labelled)} tCO₂e</div><span className="badge text-white mt-1" style={{ background: STATUS_COLOR[f.status] ?? '#888' }}>{f.status ?? '—'}</span></Link></li>)}</ul>
          {farms.total > farms.size && <div className="mt-3 flex items-center gap-2 text-sm"><button className="btn-ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('list.prev')}</button><span>{t('list.page', { p: page, t: Math.ceil(farms.total / farms.size) })}</span><button className="btn-ghost" disabled={page * farms.size >= farms.total} onClick={() => setPage(page + 1)}>{t('list.next')}</button></div>}</>}
      </section>
      <SheetFooter source={d.data_source} />
    </article>
  );
}
