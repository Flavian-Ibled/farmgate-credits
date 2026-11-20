import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, fmt } from '../api';

export function Kpi({ value, label, badge }: { value: string; label: string; badge?: string }) {
  return (
    <div className="card p-4">
      <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-soil tabular-nums">{value}</div>
      <div className="mt-1 text-sm">{label}</div>
      {badge && <span className="badge mt-2 bg-wheat/30">{badge}</span>}
    </div>
  );
}
export default function Home() {
  const { t } = useTranslation();
  const [s, setS] = useState<any>(null), [meta, setMeta] = useState<any>(null), [err, setErr] = useState('');
  useEffect(() => { api('/public/summary').then(setS).catch(e => setErr(e.message)); api('/public/projects').then(setMeta).catch(() => {}); }, []);
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:py-16">
      <p className="inline-block text-xs font-bold uppercase tracking-widest text-leaf-dark bg-mist rounded-full px-3 py-1">Label Bas Carbone · France</p>
      <h1 className="mt-4 text-3xl sm:text-4xl md:text-6xl leading-[1.1] max-w-4xl">{t('promise')}</h1>
      <p className="mt-5 text-lg max-w-3xl opacity-90">{t('home.lead')}</p>
      <Link to="/carte" className="btn mt-6 text-base px-6 py-3">{t('home.cta')} →</Link>

      <section aria-label="Chiffres clés" className="mt-12">
        {err && <p role="alert" className="text-red-700">{t('error')} {err}</p>}
        {!s && !err && <p>{t('loading')}</p>}
        {s && (<>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Kpi value={fmt(s.farms)} label={t('kpi.farms')} />
            <Kpi value={fmt(s.sau)} label={t('kpi.sau')} />
            <Kpi value={fmt(s.re_labelled_5y)} label={t('kpi.labelled')} badge={t('status.estimated')} />
            <Kpi value={fmt(s.vol_vendu)} label={t('kpi.sold')} />
            <Kpi value={fmt(s.vol_dispo)} label={t('kpi.available')} />
            <Kpi value={fmt(s.followup_r25.measured)} label={`${t('kpi.measured')} · ${t('s.followed', { n: s.followup_r25.farms_followed })}`} badge={t('status.measured')} />
          </div>
          <p className="mt-3 text-xs opacity-75">{t('source')} : Data Master Carbone Farmers (import n° {s.import_id ?? '—'}). {t('home.estimate')}</p>
        </>)}
      </section>

      <section className="mt-14">
        <h2 className="text-2xl md:text-3xl font-bold">{t('home.how')}</h2>
        <ol className="mt-5 grid md:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => (<li key={i} className="card p-5"><div className="w-9 h-9 rounded-full bg-apple text-white font-bold flex items-center justify-center">{i}</div><h3 className="mt-1 text-lg font-bold">{t(`home.how${i}`)}</h3><p className="mt-1 text-sm opacity-90">{t(`home.how${i}d`)}</p></li>))}
        </ol>
      </section>

      {meta && (
        <section className="mt-14">
          <h2 className="text-2xl md:text-3xl font-bold">{t('home.projects')}</h2>
          <ul className="mt-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {meta.map((p: any) => (
              <li key={p.slug}><Link to={`/projets/${p.slug}`} className="card p-4 block h-full hover:border-leaf">
                <div className="font-bold text-soil">{p.name}</div>{p.porteur && <div className="text-xs opacity-75">{p.porteur}</div>}
                <div className="mt-2 text-sm tabular-nums">{fmt(p.farms)} {t('kpi.farms')} · {fmt(p.sau)} ha</div><div className="text-sm tabular-nums">{fmt(p.re_labelled)} tCO₂e · {fmt(p.vol_dispo)} {t('kpi.available').replace('tCO₂e ', '')}</div>
                {p.followed > 0 && <span className="badge bg-apple text-white mt-2">{t('s.followed', { n: p.followed })} R25</span>}
              </Link></li>))}
          </ul>
        </section>)}
    </div>
  );
}
