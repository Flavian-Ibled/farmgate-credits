import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, fmt } from '../api';
import { Stamp, useTr } from './Impact';

export default function Downloads() {
  const { t } = useTranslation(); const tr = useTr(); const [d, setD] = useState<any>(null);
  useEffect(() => { api('/public/downloads').then(setD).catch(() => {}); document.title = `${tr('Données ouvertes', 'Open data')} — Farmgate Credits`; }, []);
  if (!d) return <p className="p-8">{t('loading')}</p>;
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-10">
      <p className="text-xs font-bold uppercase tracking-widest text-leaf-dark">{tr('Transparence', 'Transparency')}</p><h1 className="mt-1 text-3xl sm:text-5xl">{tr('Données ouvertes', 'Open data')}</h1>
      <p className="mt-3">{tr('Les données agrégées et non identifiantes du portefeuille : pas de nom d’agriculteur, d’adresse, de position exacte, de prix ni de contrat. Les crédits labellisés et les projections sont des estimations sous réserve du suivi annuel et de l’audit.', 'Aggregated, non-identifying portfolio data: no farmer name, address, exact position, price or contract. Labelled credits and projections are estimates subject to annual follow-up and audit.')}</p>
      <div className="mt-2"><Stamp asOf={d.data_as_of} source="Data Master Carbone Farmers" /></div>
      <p className="mt-2 text-sm"><span className="badge bg-wheat/40">{tr('licence à définir par Carbone Farmers', 'licence to be defined by Carbone Farmers')}</span> {tr('Fichiers CSV : séparateur « ; », encodage UTF-8, point décimal.', 'CSV files: “;” separator, UTF-8, decimal point.')}</p>
      <div className="card p-4 mt-4 flex flex-wrap items-center gap-3"><div className="mr-auto"><div className="font-bold text-soil">{tr('Tout en un seul classeur Excel', 'Everything in one Excel workbook')}</div><div className="text-xs">{tr('Les trois jeux de données et le dictionnaire.', 'The three datasets and the dictionary.')}</div></div><a className="btn" href="/api/public/downloads/farmgate_data.xlsx" download>↓ Excel</a></div>
      {d.datasets.map((s: any) => <section key={s.name} className="card p-4 mt-3"><div className="flex flex-wrap items-center gap-3"><div className="mr-auto"><h2 className="text-lg">{s.title}</h2><div className="text-xs opacity-75">{fmt(s.rows)} {tr('lignes', 'rows')} · {s.columns.length} {tr('colonnes', 'columns')}</div></div><a className="btn-ghost" href={`/api/public/downloads/${s.name}.csv`} download>↓ CSV</a></div>
        <details className="mt-2"><summary className="cursor-pointer text-sm font-medium">{tr('Dictionnaire des colonnes', 'Column dictionary')}</summary><table className="w-full text-sm mt-2"><tbody>{s.columns.map((c: any) => <tr key={c.name} className="border-b border-line last:border-0"><td className="py-1 pr-3 font-mono text-xs align-top">{c.name}</td><td className="py-1">{c.description}</td></tr>)}</tbody></table></details></section>)}
    </div>
  );
}
