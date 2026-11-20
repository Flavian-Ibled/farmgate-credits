// Farm sheet in the platform's own format (same building blocks as the project page): key figures, credits trajectory,
// carbon balance, identity, annual follow-up, action plan, co-benefits (those chosen for display), team, funding, story.
// Anything the data does not provide stays an "à fournir" slot, fillable in the admin.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Circle } from 'react-leaflet';
import { api, fmt, pct, share, STATUS_COLOR } from '../api';
import { Pie, Tile, Tbd, Trajectory, Scorecards, Scale, SheetFooter, PdfButton, isPrint } from '../components/Sheet';
import { FuBadge } from './FollowUps';
import { CatIcon, IndIcon } from '../components/Icons';
import { ScoreBar } from './Ranking';
import { BuyButton } from './Shop';

const Card = ({ title, children, className = '', aside }: { title: string; children: ReactNode; className?: string; aside?: ReactNode }) => <section className={`card p-4 sm:p-5 break-inside-avoid ${className}`}><div className="flex items-start justify-between gap-2"><h2 className="text-base">{title}</h2>{aside}</div><div className="mt-2">{children}</div></section>;
const Line = ({ k, v }: { k: string; v: ReactNode }) => <div className="flex justify-between gap-4 py-1.5 border-b border-line last:border-0 text-sm"><dt className="opacity-80">{k}</dt><dd className="font-medium text-right">{v ?? <Tbd />}</dd></div>;
export const TREND = { better: '#377E25', worse: '#9A3333', same: '#404040' } as const;

function Groups({ groups, legend }: { groups: { name: string; bars: { k: string; v: number | null; c: string }[] }[]; legend: string }) {
  const { t } = useTranslation(); const max = Math.max(0.001, ...groups.flatMap(g => g.bars.map(b => Math.abs(b.v ?? 0))));
  return (
    <div><div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${groups.length}, 1fr)` }} role="img" aria-label={groups.map(g => `${g.name} : ${g.bars.map(b => `${b.k} ${b.v == null ? t('tbd') : fmt(b.v)}`).join(', ')}`).join(' ; ')}>
      {groups.map(g => <div key={g.name}><div className="flex items-end justify-center gap-1.5 h-36 border-b-2 border-soil/30">{g.bars.map(b => <div key={b.k} className="flex-1 max-w-14 h-full flex flex-col justify-end items-center">{b.v == null ? <span className="text-[10px] italic opacity-60 mb-6 text-center leading-tight">{t('tbd')}</span> : <><span className="text-[11px] font-semibold tabular-nums">{fmt(b.v)}</span><span className="w-full rounded-t" style={{ height: `${Math.max(2, (Math.abs(b.v) / max) * 80)}%`, background: b.c }} /></>}</div>)}</div>
        <div className="flex justify-center gap-1.5 text-[10px] mt-1">{g.bars.map(b => <span key={b.k} className="flex-1 max-w-14 text-center">{b.k}</span>)}</div><div className="text-center text-xs font-bold text-soil mt-0.5">{g.name}</div></div>)}
    </div><p className="text-[11px] opacity-75 mt-2">{legend}</p></div>
  );
}

export default function FarmPage() {
  const { id } = useParams(); const { t, i18n } = useTranslation(); const print = isPrint(); const en = i18n.language === 'en';
  const [d, setD] = useState<any>(null), [err, setErr] = useState(''), [adm, setAdm] = useState<any>(null);
  useEffect(() => { setD(null); api(`/public/farms/${id}`).then(setD).catch(e => setErr(e.message)); }, [id]);
  // administrators also get the identity of the farm (never sent to other visitors, never printed)
  useEffect(() => { setAdm(null); api('/auth/me').then(m => { if (m && ['platform_admin', 'staff'].includes(m.role)) api(`/admin/farms/${id}`).then(setAdm).catch(() => {}); }).catch(() => {}); }, [id]);
  useEffect(() => { if (d) document.title = `${d.name ?? `${t('farm.anonymous')} ${d.id}`} — Farmgate Credits`; }, [d]);
  if (err) return <p role="alert" className="p-8 text-red-700">{err}</p>;
  if (!d) return <p className="p-8">{t('loading')}</p>;
  const c = d.carbon, fu = d.followup, S = d.sheet ?? {}, F = d.funding; const date = (s: string | null) => (s ? new Date(s).toLocaleDateString(en ? 'en-GB' : 'fr-FR') : null);
  const title = d.name ?? `${t('farm.anonymous')} ${d.id}`; const sau: number | null = d.sau;
  const fy = d.followups.find((x: any) => x.status !== 'planned'); const yr = fy?.harvest_year ?? fu?.harvest_year; const R = yr ? `R${String(yr).slice(2)}` : t('fp2.followShort');
  const tot = (v: number | null | undefined) => (v != null && sau ? v * sau : null);
  const net = (e: number | null | undefined, s: number | null | undefined) => (e != null ? e - (s ?? 0) : null);
  const netI = net(c.em_init_ha, c.st_init_ha), netT = net(c.em_target_ha, c.st_target_ha), netY = net(fy?.em_year_ha, fy?.st_year_ha);
  const ch = (a: number | null | undefined, b: number | null | undefined) => (a && b != null ? b / a - 1 : null);
  const hasSplit = c.re_avoidance != null && c.re_storage != null && c.re_avoidance + c.re_storage > 0; const split = hasSplit ? c.re_avoidance / (c.re_avoidance + c.re_storage) : null;
  const lab = c.re_labelled ?? 0, sold = F ? F.allocated : c.vol_vendu ?? 0, avail = F ? F.remaining : c.vol_dispo ?? 0, base = F?.sellable || lab; const dossier = S.dossier_lbc ?? d.lbc_dossier_number;
  const levers: any[] | null = S.levers?.length ? S.levers : d.levers === null ? null : d.levers.map((f: any) => ({ name: f.family, change: f.items.map((l: any) => `${l.description_fr ?? l.name_fr}${l.cost_annual_eur_ha != null ? ` (${t('lv.cost')} ${fmt(Number(l.cost_annual_eur_ha), 1)} €/ha)` : ''}${l.saving_eur_ha != null ? ` (${t('lv.saving')} ${fmt(Number(l.saving_eur_ha), 1)} €/ha)` : ''}`).join(' · '), credits: null, nature: f.items.some((l: any) => l.type === 'storage') ? 'storage' : 'avoidance' }));
  const levTotal = (levers ?? []).reduce((s, l) => s + (l.credits ?? 0), 0);
  const items = d.scorecards.flatMap((s: any) => s.items.map((i: any) => ({ ...i, category: s.category }))).filter((i: any) => i.collected && i.evolution != null);
  const cropYear = d.crops.some((x: any) => x.harvest_year === 0) ? 0 : d.crops[0]?.harvest_year; const crops = d.crops.filter((x: any) => x.harvest_year === cropYear).sort((a: any, b: any) => b.hectares - a.hectares);
  const intro = S.intro ?? [t('fp2.autoFarm', { type: (d.typology ?? '—').toLowerCase(), sau: sau != null ? fmt(sau) : '—', dept: d.departement ?? '—', region: d.region ?? '—' }), d.project ? t('fp3.autoJoin', { project: d.project }) : '', ch(netI, netT) != null ? t('sl.autoPlan', { p: pct(ch(netI, netT)) }) : '', t('sl.autoLab', { lab: fmt(lab) })].filter(Boolean).join(' ');
  const evol: [string, string, number | null][] = [[t('sl.net'), netI != null && netY != null ? `${fmt(netI, 2)} → ${fmt(netY, 2)} tCO₂e/ha/an` : '', ch(netI, netY)], [t('fp2.gross'), c.em_init_ha != null && fy?.em_year_ha != null ? `${fmt(c.em_init_ha, 2)} → ${fmt(fy.em_year_ha, 2)} tCO₂e/ha/an` : '', ch(c.em_init_ha, fy?.em_year_ha)]];
  return (
    <article className="mx-auto max-w-6xl px-4 py-6 sm:py-10 print:py-2 print:px-0">
      {adm && !print && <aside className="print:hidden mb-4 rounded-2xl border-2 border-brown/40 bg-wheat/15 p-4 text-sm" aria-label={t('av.banner')}><div className="text-xs font-bold uppercase tracking-widest text-brown">{t('av.banner')}</div>
        <dl className="mt-2 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-1"><div><dt className="text-xs opacity-70">{t('av.farm')}</dt><dd className="font-bold text-soil">{adm.name ?? '—'}{adm.legal_status ? ` (${adm.legal_status})` : ''}</dd></div><div><dt className="text-xs opacity-70">{t('av.farmer')}</dt><dd className="font-bold text-soil">{adm.farmer ?? '—'}</dd></div><div><dt className="text-xs opacity-70">{t('av.address')}</dt><dd>{[adm.address, adm.postal_code, adm.commune].filter(Boolean).join(' ') || '—'}</dd></div><div><dt className="text-xs opacity-70">{t('av.referent')}</dt><dd>{adm.diagnostic_referent ?? '—'}</dd></div></dl>
        <Link className="btn mt-3" to={`/admin?ferme=${d.id}`}>{t('av.edit')}</Link></aside>}
      <nav className="text-sm print:hidden"><Link to="/" className="underline">{t('nav.home')}</Link> / {d.project_slug && <><Link className="underline" to={`/projets/${d.project_slug}`}>{d.project}</Link> / </>}{d.id}</nav>
      <header className="mt-3 flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-64"><p className="text-xs font-bold uppercase tracking-widest text-leaf-dark">{t('fp.sheet')} · Label Bas Carbone</p>
          <h1 className="mt-1 text-2xl sm:text-4xl">{title}</h1>
          <ul className="mt-2 flex flex-wrap gap-1.5 text-xs font-bold"><li className="badge text-white" style={{ background: STATUS_COLOR[d.lbc_status] ?? '#888' }}>{d.lbc_status ?? '—'}</li><li className="badge bg-soil text-white">{d.id}</li>{d.typology && <li className="badge bg-line">{d.typology}</li>}<li className="badge bg-line">{d.departement} · {d.region}</li>{fu && <li className="badge bg-apple text-white">{t('sl.followChip', { y: fu.harvest_year })}</li>}<li className="badge bg-line">{t('fp.dossier')} n° {dossier ?? t('tbd')}</li></ul>
          <p className="mt-3 text-sm max-w-3xl">{intro}</p></div>
        <div className="flex items-center gap-3"><img src="/brand/lbc.png" alt="Label Bas Carbone" className="h-9 w-auto" /><PdfButton path={`/fermes/${d.id}`} /></div>
      </header>

      <section className="mt-6 grid grid-cols-2 lg:grid-cols-4 print:grid-cols-4 gap-3" aria-label={t('p.key')}>
        <Tile value={fmt(lab)} label={t('fp.expected')} sub={`${t('sl.cInitial')} · ${t('sl.cInitialSub')}`} />
        <Tile tone="apple" value={fu ? fmt(fu.re_total) : '—'} label={fu ? t('sl.measuredIn', { y: fu.harvest_year }) : t('fp.measured')} sub={fu?.end_of_project_estimate != null ? `${t('sl.cReest')} : ${fmt(fu.end_of_project_estimate)} tCO₂e` : t('p.noFollowup')} />
        <Tile tone="brown" value={sau != null ? fmt(sau) : '—'} label="ha (SAU)" sub={c.re_ha_yr != null ? `${fmt(c.re_ha_yr, 2)} tCO₂e/ha/an` : undefined} />
        <Tile tone="brown" value={fmt(avail)} label={t('kpi.available')} sub={base ? `${share(sold / base)} ${t('sl.fundedLine')}` : undefined} />
      </section>

      <section className="mt-3 grid lg:grid-cols-2 print:grid-cols-2 gap-3">
        <Trajectory initial={lab} generated={fu?.re_total ?? null} estimate={fu?.end_of_project_estimate ?? null} year={fu?.harvest_year} formula={fu?.formula} />
        <Card title={`${t('sl.balance')} (tCO₂e ${t('sl.perYear')})`}>
          <Groups legend={t('sl.sign')} groups={[{ name: t('fp2.gross'), bars: [{ k: t('fp2.init'), v: tot(c.em_init_ha), c: '#529a38' }, { k: R, v: tot(fy?.em_year_ha), c: '#377E25' }, { k: t('fp2.target'), v: tot(c.em_target_ha), c: '#86b56d' }] }, { name: t('sl.storage'), bars: [{ k: t('fp2.init'), v: tot(c.st_init_ha), c: '#885104' }, { k: R, v: tot(fy?.st_year_ha), c: '#a06e36' }, { k: t('fp2.target'), v: tot(c.st_target_ha), c: '#C8994F' }] }, { name: t('sl.net'), bars: [{ k: t('fp2.init'), v: tot(netI), c: '#1e4414' }, { k: R, v: tot(netY), c: '#275B1A' }, { k: t('fp2.target'), v: tot(netT), c: '#377E25' }] }]} />
          {split != null ? <div className="mt-3"><Pie avoid={c.re_avoidance} store={c.re_storage} caption={t('fp3.pieLab')} /></div> : fu && fu.re_avoidance >= 0 && fu.re_storage >= 0 && fu.re_total > 0 ? <div className="mt-3"><Pie avoid={fu.re_avoidance} store={fu.re_storage} caption={t('fp3.pieMeas', { y: fu.harvest_year })} /><p className="text-[11px] opacity-70 mt-1">{t('p.noSplit')}</p></div> : <p className="mt-3 text-xs"><Tbd owner="Équipe data" /> {t('p.noSplit')}</p>}
        </Card>
      </section>

      <section className="mt-3 grid lg:grid-cols-2 print:grid-cols-2 gap-3">
        <Card title={t('fp.identity')}><dl>
          <Line k={t('f.project')} v={d.project_slug ? <Link className="underline" to={`/projets/${d.project_slug}`}>{d.project}</Link> : d.project} /><Line k={t('f.porteur')} v={d.porteur} /><Line k={t('b.f.mandatary')} v="Carbone Farmers" />
          <Line k={t('fp.refPeriod')} v={d.reference_period} /><Line k={t('fp.projPeriod')} v={d.project_period} /><Line k={t('fp.system')} v={null} />
          <Line k={t('fp.crops')} v={crops.length ? <>{crops.slice(0, 5).map((x: any) => `${x.crop} ${share(Number(x.share))}`).join(' · ')}<span className="block text-[11px] opacity-70 font-normal">{cropYear === 0 ? t('sl.cropsInit') : cropYear === 9999 ? t('sl.cropsPros') : cropYear}</span></> : null} />
          <Line k={t('s.lastDiag')} v={date(d.last_diag_date)} /><Line k={t('fp.verified')} v={d.verified_at ? `${date(d.verified_at)}${d.verified_by ? ` · ${d.verified_by}` : ''}` : null} /></dl></Card>
        <Card title={t('fp2.followTitle')}>
          {d.roadmap ? <ol className="grid grid-cols-5 gap-1.5">{d.roadmap.map((r: any) => <li key={r.label} className={`rounded-xl p-2 text-center border ${r.status === 'planned' ? 'bg-white border-line' : r.status === 'audited' ? 'bg-soil text-white border-soil' : 'bg-apple text-white border-apple'}`}><div className="font-bold text-sm">{r.label}</div><div className="text-[9px] leading-tight break-words">{t(`fu.st_${r.status}`)}</div></li>)}</ol> : <p className="text-sm"><Tbd owner="Équipe data" /> {t('fp.noRoadmap')}</p>}
          {fy ? <><ul className="mt-3 space-y-1.5">{evol.map(([k, sub, v]) => <li key={k} className="rounded-xl bg-mist px-3 py-2 flex items-center gap-3"><div className="flex-1"><div className="font-bold text-soil text-sm">{k}</div><div className="text-xs">{sub || <Tbd owner="Agronomes" />}</div></div><div className="text-xl font-bold text-soil tabular-nums">{v != null ? pct(v) : '—'}</div></li>)}</ul>
            <div className="overflow-x-auto"><table className="w-full text-sm mt-3"><thead><tr className="text-left border-b border-line">{[t('fua.year'), t('al.label'), t('s.avoid'), t('s.storage'), t('fu.measuredYear')].map(h => <th key={h} className="py-1 pr-3 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{d.followups.map((x: any) => <tr key={x.harvest_year} className="border-b border-line last:border-0"><td className="py-1 pr-3 font-medium">R{String(x.harvest_year).slice(2)}{x.diagnostic_date && <span className="block text-[11px] opacity-70">{date(x.diagnostic_date)}</span>}</td><td className="pr-3"><FuBadge s={x.status} /></td><td className="pr-3 tabular-nums">{fmt(x.re_avoidance)}</td><td className="pr-3 tabular-nums">{fmt(x.re_storage)}</td><td className="pr-3 tabular-nums font-semibold">{fmt(x.measured)}</td></tr>)}</tbody></table></div>
            <p className="text-[11px] opacity-75 mt-2">{t('sl.evolNote', { ref: d.reference_period ?? '—' })}</p></> : <p className="mt-3 text-sm">{t('p.noFollowup')}</p>}
        </Card>
      </section>

      <Card className="mt-3" title={t('fp2.levers')} aside={<span className="text-[11px] italic opacity-75">{t('fp2.leversHint')}</span>}>
        {levers === null ? <p className="text-sm"><Tbd owner="Agronomes" /> {t('fp.noLevers')}</p> : levers.length === 0 ? <p className="text-sm">{t('fp.zeroLevers')}</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b border-line"><th className="py-1.5 pr-3 font-semibold w-1/4">{t('fp2.lever')}</th><th className="pr-3 font-semibold">{t('sl.change')}</th><th className="pr-3 font-semibold whitespace-nowrap">{t('fp2.credits')}</th><th className="font-semibold">{t('fp2.nature')}</th></tr></thead>
          <tbody>{levers.map((l, i) => <tr key={i} className="border-b border-line last:border-0 align-top"><td className="py-2 pr-3"><span className="font-bold text-soil">{l.name}</span>{l.desc && <span className="block text-xs">{l.desc}</span>}</td><td className="py-2 pr-3">{l.change ?? <Tbd owner="Agronomes" />}</td><td className="py-2 pr-3 whitespace-nowrap tabular-nums">{l.credits != null ? <>{fmt(l.credits)} tCO₂e{levTotal > 0 && <> · {share(l.credits / levTotal)}</>}</> : <Tbd owner="Agronomes" />}</td><td className="py-2 text-xs">{l.nature === 'storage' ? t('s.storage') : t('s.avoid')}</td></tr>)}</tbody></table></div>}
      </Card>

      <section className="mt-8"><div className="flex flex-wrap items-end justify-between gap-2"><h2 className="text-xl sm:text-2xl">{t('s.cob')}</h2><Scale /></div>
        <p className="text-xs opacity-75 mt-1">{t('fp3.cobShown', { n: d.cobenefits.shown, t: d.cobenefits.tracked })} {t('fp2.cobHint')}.</p>
        <div className="mt-3 grid md:grid-cols-2 print:grid-cols-2 gap-3">
          <div className="card p-4 break-inside-avoid"><div className="flex items-baseline justify-between gap-2"><h3 className="text-base">{t('rk.eau')}</h3>{d.scores.eau && d.scores.eau.status !== 'valide' && <span className="badge bg-wheat/40">à valider</span>}</div>
            {d.scores.eau ? <><div className="mt-1"><span className="text-4xl font-bold text-soil tabular-nums">{fmt(d.scores.eau.score, 0)}</span><span className="text-sm"> /100 · {t('rk.inProject', { r: d.scores.eau.rank, n: d.scores.eau.pool })}</span></div><p className="text-xs mt-1">{t('rk.blocks', { a: fmt(d.scores.eau.blocks.lixiviation, 0), b: fmt(d.scores.eau.blocks.consommation, 0), c: fmt(d.scores.eau.blocks.autres, 0) })}</p><p className="text-[11px] opacity-75 mt-1">{t('rk.dataShare', { p: share(d.scores.eau.completeness) })} · v{d.scores.eau.version} · {d.scores.eau.level_basis === 'initial' ? t('rk.bInit') : t('rk.bPros')} + {t('sc.evol')}</p></> : <p className="text-sm mt-1">{t('rk.none')}</p>}</div>
          <div className="card p-4 break-inside-avoid"><div className="flex items-baseline justify-between gap-2"><h3 className="text-base">{t('rk.bio')}</h3>{d.scores.bio && d.scores.bio.status !== 'valide' && <span className="badge bg-wheat/40">à valider</span>}</div>
            {d.scores.bio ? <><div className="mt-1"><span className="text-4xl font-bold text-soil tabular-nums">{d.scores.bio.displayed != null ? fmt(d.scores.bio.displayed, 0) : '—'}</span><span className="text-sm"> /100 · {t('rk.relProject', { n: d.scores.bio.pool, f: d.scores.bio.floor, c: d.scores.bio.ceiling })}</span></div><p className="text-xs mt-1">{t('rk.raw', { v: fmt(d.scores.bio.raw, 1) })} · {t('rk.dataShare', { p: share(d.scores.bio.completeness) })} · v{d.scores.bio.version}</p></> : <p className="text-sm mt-1">{t('rk.none')}</p>}</div></div>
        {items.length > 0 && <div className="mt-3 grid grid-cols-2 md:grid-cols-4 print:grid-cols-4 gap-2">{items.slice(0, 8).map((it: any) => { const sh = it.unit === 'part de SAU'; const f = (v: number) => (sh ? share(v, 1) : fmt(v, Math.abs(v) < 100 ? 1 : 0)); return (
          <div key={it.code} className="rounded-2xl bg-mist p-3 break-inside-avoid"><div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-leaf-dark"><CatIcon cat={it.category} size={24} />{it.category}</div><div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: TREND[(it.trend ?? 'same') as keyof typeof TREND] }}>{pct(it.evolution)}</div><div className="text-xs mt-0.5 flex items-center gap-1"><IndIcon code={it.code} size={18} />{en ? it.label_en : it.label_fr}</div><div className="text-[11px] opacity-75">{f(it.initial)} → {f(it.prospectif)}{sh ? '' : ` ${it.unit}`}</div></div>); })}</div>}
        <div className="mt-3"><Scorecards cards={d.scorecards} farm /></div></section>

      <section className="mt-3 grid lg:grid-cols-3 print:grid-cols-3 gap-3">
        <Card title={t('fp2.team')}><div className="font-bold text-soil">{S.agronomist?.name ?? <Tbd owner="Carbone Farmers" />}</div><div className="text-sm">{S.agronomist?.role ?? t('sl.agroRole')}</div><p className="text-xs mt-1">{S.agronomist?.text ?? t('fp2.teamText')}</p>
          <div className="mt-3 text-xs font-bold uppercase tracking-widest text-leaf-dark">{t('fp2.contact')}</div>{S.contact?.name ? <div className="text-sm"><strong>{S.contact.name}</strong>{S.contact.role && <> · {S.contact.role}</>}<div>{[S.contact.phone, S.contact.email].filter(Boolean).join(' · ')}</div></div> : <Tbd owner="Carbone Farmers" />}</Card>
        <Card title={t('fp3.funding')}><div className="text-3xl font-bold text-soil tabular-nums">{fmt(avail)} <span className="text-sm font-normal">tCO₂e {t('fp2.stillAvail')}</span></div>
          <div className="mt-2 h-3 rounded-full overflow-hidden flex" role="img" aria-label={`${t('sl.fundedLine')} ${fmt(sold)}, ${t('fp2.stillAvail')} ${fmt(avail)}`} style={{ background: '#d1e3c7' }}><div style={{ width: `${base ? Math.min(100, (sold / base) * 100) : 0}%`, background: '#529a38' }} /></div>
          <p className="text-sm mt-2">{fmt(sold)} tCO₂e {t('sl.fundedLine')}{base ? ` (${share(sold / base, 1)})` : ''} · {fmt(lab)} tCO₂e {t('fp2.over5')}</p>
          <div className="mt-3"><BuyButton type="farm" id={d.id} /></div>
          {F && F.allocated > 0 && <p className="text-xs mt-1">{F.funders.length ? <>{t('sl.fundedBy')} : <strong>{F.funders.join(', ')}</strong>{F.n_funders > F.funders.length ? ` ${t('sl.andOthers')}` : ''}</> : t('sl.fundersPrivate')}</p>}</Card>
        <Card title={t('sl.payout')}>{(() => { const pctF = S.payout_share ?? d.remuneration.farmer_pct; return <><div className="text-3xl font-bold text-soil tabular-nums">{fmt(pctF, pctF % 1 ? 1 : 0)} %</div><p className="text-sm mt-1">{t('sl.payoutSub')}{S.payout_share == null && d.remuneration.source === 'default' ? ` · ${t('mo.minimum')}` : ''}{S.payout_share == null && d.remuneration.advice_pct > 0 ? ` · ${t('mo.inclAdvice', { p: fmt(d.remuneration.advice_pct, 1) })}` : ''}</p></>; })()}
          {d.lever_costs ? <p className="text-xs mt-2">{t('mo.costLine', { c: fmt(d.lever_costs.cost_annual_eur_ha, 1), s: fmt(d.lever_costs.saving_eur_ha, 1), n: fmt(d.lever_costs.net_eur_ha, 1) })}</p> : <p className="text-xs mt-2 opacity-80">{t('mo.costTbd')}</p>}</Card>
      </section>

      <section className="mt-3 grid lg:grid-cols-2 print:grid-cols-2 gap-3">
        <Card title={t('fp.story')}>{(['context', 'motivations', 'stakes'] as const).map(k => <div key={k} className="mb-2"><h3 className="text-sm text-leaf-dark">{t(`fp.${k}`)}</h3><p className="text-sm">{S.story?.[k] ?? d.story?.[k] ?? <Tbd owner="Carbone Farmers" />}</p></div>)}
          <div className="grid grid-cols-4 gap-2 mt-3">{[t('sl.ph1'), t('sl.ph2'), t('sl.ph3'), t('sl.ph4')].map((p, i) => d.media[i] ? <figure key={i}><img src={d.media[i].file_url} alt={d.media[i].alt_fr ?? ''} loading="lazy" className="rounded-lg w-full h-20 object-cover" /><figcaption className="text-[10px]">{d.media[i].caption_fr ?? p}</figcaption></figure> : <div key={i} className="rounded-lg border-2 border-dashed border-line h-20 flex items-center justify-center text-[10px] text-center px-1 opacity-80">{p}</div>)}</div></Card>
        <Card title={t('fp.map')}>{d.lat != null && !print ? <div className="h-56 rounded-xl overflow-hidden"><MapContainer center={[d.lat, d.lng]} zoom={8} className="h-full w-full z-0" scrollWheelZoom={false}><TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><Circle center={[d.lat, d.lng]} radius={5000} pathOptions={{ color: '#529a38', fillOpacity: 0.25 }} /></MapContainer></div> : <div className="h-24 rounded-xl bg-mist flex flex-col items-center justify-center"><div className="text-2xl font-bold text-soil">{d.departement}</div><div className="text-sm">{d.region}</div></div>}<p className="text-xs opacity-75 mt-2">{d.bassin ? `${t('f.bassin')} : ${d.bassin}. ` : ''}{t('fp.blur')}</p></Card>
      </section>
      <SheetFooter source={d.data_source} />
    </article>
  );
}
