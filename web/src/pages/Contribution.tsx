// Funder public page "Notre contribution" and its embeddable widget (opt-in; aggregates only, never amounts).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, fmt, pct } from '../api';
import { Tile } from '../components/Sheet';
import { Stamp, useTr } from './Impact';
import { IndIcon } from '../components/Icons';

export default function Contribution({ embed = false }: { embed?: boolean }) {
  const { slug } = useParams(); const { t, i18n } = useTranslation(); const tr = useTr(); const en = i18n.language === 'en'; const [d, setD] = useState<any>(null), [err, setErr] = useState(false), [copied, setCopied] = useState(false);
  useEffect(() => { api(`/public/funders/${slug}`).then(setD).catch(() => setErr(true)); }, [slug]);
  useEffect(() => { if (d) document.title = `${d.name} — ${tr('Notre contribution', 'Our contribution')}`; }, [d]);
  if (err) return <p className="p-8 text-center">{tr('Cette page n’existe pas ou n’est pas publique.', 'This page does not exist or is not public.')}</p>; if (!d) return <p className="p-8">{t('loading')}</p>;
  const code = `<iframe src="${location.origin}/widget/${d.slug}" width="100%" height="460" style="border:0" title="${tr('Notre contribution avec Carbone Farmers', 'Our contribution with Carbone Farmers')}" loading="lazy"></iframe>`;
  return (
    <div className={`mx-auto max-w-4xl px-4 ${embed ? 'py-3' : 'py-6 sm:py-10'}`}>
      <div className="flex items-center gap-3"><img src="/brand/logo.svg" alt="Carbone Farmers" className="h-8" /></div>
      <p className="mt-3 text-xs font-bold uppercase tracking-widest text-leaf-dark">{tr('Notre contribution', 'Our contribution')}</p><h1 className={`mt-1 ${embed ? 'text-2xl' : 'text-3xl sm:text-5xl'}`}>{d.name}</h1>
      <p className="mt-2 max-w-3xl">{tr(`${d.name} finance la transition bas carbone de ${d.farms} ferme${d.farms > 1 ? 's' : ''}, avec Carbone Farmers, dans le cadre du Label Bas Carbone.`, `${d.name} finances the low-carbon transition of ${d.farms} farm${d.farms > 1 ? 's' : ''}, with Carbone Farmers, under the Label Bas Carbone.`)}</p>
      <section className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3"><Tile value={fmt(d.volume_tco2e)} label="tCO₂e" sub={tr('prévues sur 5 ans — estimation', 'planned over 5 years — estimate')} /><Tile tone="apple" value={d.measured_attributed != null ? fmt(d.measured_attributed) : '—'} label={tr('tCO₂e mesurées', 'tCO₂e measured')} sub={d.measured_attributed != null ? tr('récolte 2025, votre part', '2025 harvest, your share') : t('p.noFollowup')} /><Tile tone="brown" value={fmt(d.farms)} label={t('kpi.farms')} sub={`${fmt(d.sau_attributed)} ha ${t('fo.attr')}`} /><Tile tone="brown" value={fmt(d.projects.length)} label={t('s.projects')} sub={d.regions.join(' · ')} /></section>
      <p className="mt-2 text-xs opacity-75">{tr('Votre part d’une ferme = vos crédits ÷ ses crédits labellisés ; l’impact mesuré vous est attribué au prorata.', 'Your share of a farm = your credits ÷ its labelled credits; measured impact is attributed pro rata.')} {t('p.caution')}</p>
      {d.cobenefits.length > 0 && <><h2 className="text-lg mt-5">{tr('Au-delà du carbone', 'Beyond carbon')}</h2><ul className="mt-2 grid sm:grid-cols-2 gap-2">{d.cobenefits.map((x: any, i: number) => <li key={i} className="rounded-2xl bg-mist p-3 flex items-center gap-3"><span className="text-xl font-bold text-soil tabular-nums w-20">{pct(x.evolution)}</span><span className="text-sm">{en ? x.label_en : x.label_fr}</span></li>)}</ul></>}
      <h2 className="text-lg mt-5">{tr('Projets', 'Projects')}</h2><p className="text-sm">{d.projects.join(' · ')}</p>
      <div className="mt-3"><Stamp asOf={d.data_as_of} source="Data Master Carbone Farmers" /></div>
      {!embed && <section className="mt-8 card p-4"><h2 className="text-base">{tr('Intégrer sur votre site', 'Embed on your website')}</h2><p className="text-xs mt-1">{tr('Copiez ce code dans la page de votre site :', 'Copy this code into your website page:')}</p><textarea readOnly rows={3} className="mt-2 w-full border border-line rounded p-2 text-xs font-mono" value={code} onFocus={e => e.currentTarget.select()} /><button className="btn-ghost mt-1" onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? tr('Copié', 'Copied') : tr('Copier le code', 'Copy the code')}</button></section>}
    </div>
  );
}
