import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmt, pct, share } from '../api';

const Row = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-line last:border-0"><dt className="text-sm">{k}{sub && <span className="block text-xs opacity-70">{sub}</span>}</dt><dd className="font-semibold tabular-nums text-right">{v}</dd></div>
);

export default function SelectionPanel({ sel, meta }: { sel: any; meta: any }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'scale' | 'carbon' | 'levers' | 'cob'>('scale');
  if (!sel) return <p className="p-4">{t('loading')}</p>;
  if (!sel.scale.farms) return <p className="p-4">{t('s.empty')}</p>;
  const c = sel.carbon, sc = sel.scale;
  const tabs = [['scale', t('s.scale')], ['carbon', t('s.carbon')], ['levers', t('s.levers')], ['cob', t('s.cob')]] as const;
  const families = [...new Set(meta.levers.map((l: any) => l.family))] as string[];
  const lv = new Map(sel.levers.items.map((i: any) => [i.code, i]));
  const cats = [...new Set(meta.indicators.map((i: any) => i.category))] as string[];
  const cb = new Map(sel.cobenefits.map((i: any) => [i.code, i]));
  return (
    <div>
      <div role="tablist" aria-label={t('v.selection')} className="flex gap-1 p-2 border-b border-line sticky top-0 bg-white z-10">
        {tabs.map(([k, label]) => (<button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === k ? 'bg-soil text-white' : 'hover:bg-mist'}`}>{label}</button>))}
      </div>
      <div role="tabpanel" className="p-4">
        {tab === 'scale' && (<dl>
          <Row k={t('kpi.farms')} v={fmt(sc.farms)} sub={`${share(sc.share_of_portfolio_farms, 1)} ${t('s.share')}`} />
          <Row k={t('kpi.sau')} v={fmt(sc.sau)} sub={`${share(sc.share_of_portfolio_sau, 1)} ${t('s.share')} · ${t('s.nData', { n: sc.n_with_sau })}`} />
          <Row k={t('kpi.labelled')} v={fmt(c.re_labelled_5y)} sub={`${t('s.labelledDefault')} · ${t('status.estimated')}`} />
          <Row k={t('s.lastDiag')} v={c.diagnostics.latest ? new Date(c.diagnostics.latest).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'fr-FR') : t('tbd')} sub={t('s.diagCov', { n: c.diagnostics.n_with_date, v: c.diagnostics.n_verified })} />
          <Row k={t('kpi.available')} v={fmt(c.vol_dispo)} />
          <div className="mt-3 text-sm font-semibold">{sc.projects.length} {t('s.projects')}</div>
          <ul className="text-sm">{sc.projects.slice(0, 8).map((p: any) => <li key={p.key} className="flex justify-between gap-2 py-0.5"><span className="truncate">{p.key}</span><span className="tabular-nums shrink-0">{fmt(p.farms)}</span></li>)}</ul>
          <div className="mt-3 text-sm font-semibold">{sc.regions.length} {t('s.regions')}</div>
          <ul className="text-sm">{sc.regions.slice(0, 8).map((p: any) => <li key={p.key} className="flex justify-between gap-2 py-0.5"><span className="truncate">{p.key}</span><span className="tabular-nums shrink-0">{fmt(p.farms)}</span></li>)}</ul>
        </dl>)}
        {tab === 'carbon' && (<>
          <table className="w-full text-sm"><caption className="sr-only">{t('s.carbon')}</caption>
            <thead><tr className="text-left"><th className="font-medium py-1">tCO₂e/ha</th><th className="font-medium text-right">{t('s.init')}</th><th className="font-medium text-right">{t('s.pros')}</th></tr></thead>
            <tbody>
              <tr className="border-t border-line"><td className="py-1.5">{t('s.emissions')}<span className="block text-xs opacity-70">{t('s.nData', { n: c.em_init_ha.n_with_data })}</span></td><td className="text-right tabular-nums font-semibold">{fmt(c.em_init_ha.value, 2)}</td><td className="text-right tabular-nums font-semibold">{fmt(c.em_target_ha.value, 2)}</td></tr>
              <tr className="border-t border-line"><td className="py-1.5">{t('s.storage')}<span className="block text-xs opacity-70">{t('s.nData', { n: c.st_init_ha.n_with_data })}</span></td><td className="text-right tabular-nums font-semibold">{fmt(c.st_init_ha.value, 2)}</td><td className="text-right tabular-nums font-semibold">{fmt(c.st_target_ha.value, 2)}</td></tr>
            </tbody></table>
          <dl className="mt-3">
            <Row k={t('kpi.labelled')} v={fmt(c.re_labelled_5y)} sub={`${fmt(c.re_labelled_ha_yr, 2)} tCO₂e/ha/an · ${t('status.estimated')}`} />
            <Row k={`${t('s.avoid')} (5 ans)`} v={c.n_with_split ? fmt(c.re_avoidance_5y) : "—"} sub={t('s.nData', { n: c.n_with_split })} />
            <Row k={`${t('s.storage')} (5 ans)`} v={c.n_with_split ? fmt(c.re_storage_5y) : "—"} />
          </dl>
          {c.share_avoidance != null && c.share_avoidance >= 0 && c.share_storage >= 0 && (
            <div className="mt-3"><div className="text-sm font-medium">{t('s.split')}</div>
              <div className="mt-1 flex h-5 rounded overflow-hidden text-[11px] text-white font-semibold" role="img" aria-label={`${t('s.avoid')} ${share(c.share_avoidance)}, ${t('s.storage')} ${share(c.share_storage)}`}>
                <div className="bg-wheat text-soil flex items-center justify-center" style={{ width: `${c.share_avoidance * 100}%` }}>{share(c.share_avoidance)}</div>
                <div className="bg-leaf flex items-center justify-center" style={{ width: `${c.share_storage * 100}%` }}>{share(c.share_storage)}</div>
              </div><div className="mt-1 flex justify-between text-xs"><span>{t('s.avoid')}</span><span>{t('s.storage')}</span></div></div>)}
          <dl className="mt-4"><div className="text-sm font-semibold">{t('s.vol')}</div>
            <Row k={t('s.filieres')} v={fmt(c.vol_filieres)} /><Row k={t('s.sellable')} v={fmt(c.vol_vendable)} /><Row k={t('kpi.sold')} v={fmt(c.vol_vendu)} /><Row k={t('kpi.available')} v={fmt(c.vol_dispo)} />
          </dl>
          {c.followup_r25.farms_followed > 0 && (<div className="mt-4 rounded-lg bg-cream p-3 text-sm"><span className="badge bg-leaf text-white">{t('status.measured')} R25</span>
            <div className="mt-1 text-2xl font-bold text-soil tabular-nums">{fmt(c.followup_r25.measured)} tCO₂e</div>
            <div className="text-xs">{t('s.followed', { n: c.followup_r25.farms_followed })} · {t('s.vsLabel', { v: fmt(c.followup_r25.labelled_of_followed) })}</div></div>)}
        </>)}
        {tab === 'levers' && (<>
          <p className="text-xs mb-3"><span className="badge bg-wheat/30">{t('s.leverCov', { n: sel.levers.n_with_data, t: sc.farms })}</span></p>
          {families.map(fam => (<div key={fam} className="mb-4"><h3 className="text-sm font-bold">{fam}</h3>
            <ul>{meta.levers.filter((l: any) => l.family === fam).map((l: any) => { const x: any = lv.get(l.code); return (
              <li key={l.code} className="py-1"><div className="flex justify-between gap-2 text-sm"><span>{l.name_fr}</span><span className="tabular-nums shrink-0" title={t('s.haShare')}>{share(x?.share_farms)} · {share(x?.share_sau)} ha</span></div>
                <div className="h-1.5 bg-cream rounded"><div className="h-1.5 bg-leaf rounded" style={{ width: `${(x?.share_farms ?? 0) * 100}%` }} /></div></li>); })}</ul></div>))}
          <p className="text-xs opacity-75">{t('s.farmsShare')} · {t('s.haShare')}</p>
        </>)}
        {tab === 'cob' && (<>
          {cats.map(cat => (<div key={cat} className="mb-4"><h3 className="text-sm font-bold">{cat}</h3>
            {meta.indicators.filter((i: any) => i.category === cat).map((d: any) => { const x: any = cb.get(d.code); const isShare = d.unit === 'part de SAU'; const f = (v: number | null) => (isShare ? share(v, 1) : fmt(v, v != null && Math.abs(v) < 100 ? 2 : 0)); return (
              <div key={d.code} className="py-2 border-b border-line last:border-0">
                <div className="flex justify-between gap-2 text-sm"><span className="font-medium">{i18n.language === 'en' ? d.label_en : d.label_fr}</span><span className="text-xs opacity-70 shrink-0">{isShare ? '%' : d.unit}</span></div>
                {!x?.collected ? <span className="badge bg-line mt-1">{t('s.notCollected')}</span> : (<>
                  <div className="mt-1 grid grid-cols-3 gap-2 text-sm tabular-nums"><div><div className="text-[11px] opacity-70">{t('s.init')}</div>{f(x.initial)}</div><div><div className="text-[11px] opacity-70">{t('s.pros')}</div>{f(x.prospectif)}</div><div><div className="text-[11px] opacity-70">{t('s.evol')}</div><span className="font-semibold">{pct(x.evolution_prospectif)}</span></div></div>
                  <span className="badge bg-wheat/30 mt-1">{t('s.coverage', { n: x.n_with_data, t: x.n_applicable })}</span></>)}
              </div>); })}</div>))}
          <p className="text-xs opacity-75">{t('s.relNote')}</p>
        </>)}
      </div>
    </div>
  );
}
