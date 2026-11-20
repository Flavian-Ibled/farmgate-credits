// Admin configuration: rating thresholds (red → green), weights, buyer-facing sentence and linked levers per indicator;
// description and estimated impact per lever; text of the 8 client blocks per project.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { RATING_COLORS } from '../components/Sheet';

const put = (path: string, body: unknown) => api(path, body, { method: 'PUT' });
const inp = 'border border-line rounded px-2 py-1 text-sm w-full bg-white';
const BLOCKS = ['geography', 'standard', 'baseline', 'volumes', 'cobenefits', 'mrv', 'contract', 'cost'];

export default function AdminConfig() {
  const { t } = useTranslation();
  const [cfg, setCfg] = useState<any>(null), [tab, setTab] = useState<'ind' | 'lev' | 'blocks'>('ind'), [msg, setMsg] = useState(''), [open, setOpen] = useState<string | null>(null), [proj, setProj] = useState('');
  const load = () => api('/admin/config').then(c => { setCfg(c); setProj(p => p || c.projects[0]?.slug || ''); }).catch(e => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const save = async (fn: () => Promise<any>) => { setMsg(''); try { await fn(); setMsg(t('cfg.saved')); load(); } catch (e: any) { setMsg(e.message); } };
  if (!cfg) return <p className="mt-4">{t('loading')}</p>;
  const P = cfg.projects.find((p: any) => p.slug === proj);
  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold">{t('cfg.title')}</h2>
      <div role="tablist" className="mt-2 flex flex-wrap gap-1">{([['ind', t('cfg.ind')], ['lev', t('cfg.lev')], ['blocks', t('cfg.blocks')]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === k ? 'bg-soil text-white' : 'bg-white border border-line'}`}>{l}</button>)}</div>
      {msg && <p role="status" className="mt-2 text-sm font-medium">{msg}</p>}

      {tab === 'ind' && <><p className="text-sm mt-2 max-w-3xl">{t('cfg.indHint')} <span className="inline-flex gap-0.5 align-middle">{RATING_COLORS.map(c => <span key={c} className="inline-block w-4 h-2.5" style={{ background: c }} />)}</span></p>
        <ul className="mt-2 space-y-2">{cfg.indicators.map((i: any) => (
          <li key={i.code} className="card p-3"><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save(() => put(`/admin/indicators/${i.code}`, { threshold_red: f.get('red'), threshold_green: f.get('green'), weight: f.get('weight'), why_fr: f.get('why_fr'), why_en: f.get('why_en'), lever_codes: f.getAll('lever'), config_status: f.get('valid') ? 'valide' : 'a_valider' })); }}>
            <div className="flex flex-wrap items-end gap-3"><div className="flex-1 min-w-56"><div className="font-semibold text-soil">{i.label_fr}</div><div className="text-xs opacity-70">{i.category} · {i.unit === 'part de SAU' ? t('cfg.fraction') : i.unit} · {i.threshold_red == null ? t('cfg.noThreshold') : Number(i.threshold_red) > Number(i.threshold_green) ? t('cfg.lower') : t('cfg.higher')}</div></div>
              <label className="text-xs w-24"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: RATING_COLORS[0] }} />{t('cfg.red')}</span><input name="red" type="number" step="any" defaultValue={i.threshold_red ?? ''} className={inp} /></label>
              <label className="text-xs w-24"><span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: RATING_COLORS[4] }} />{t('cfg.green')}</span><input name="green" type="number" step="any" defaultValue={i.threshold_green ?? ''} className={inp} /></label>
              <label className="text-xs w-20">{t('cfg.weight')}<input name="weight" type="number" step="any" min="0" defaultValue={i.weight} className={inp} /></label>
              <label className="text-xs flex items-center gap-1 pb-1.5"><input name="valid" type="checkbox" defaultChecked={i.config_status === 'valide'} />{t('cfg.validated')}</label>
              <button type="button" className="btn-ghost" onClick={() => setOpen(open === i.code ? null : i.code)}>{open === i.code ? '−' : '+'} {t('cfg.more')}</button><button className="btn !py-1.5">{t('cfg.save')}</button></div>
            <div className={open === i.code ? 'mt-3 grid md:grid-cols-2 gap-3' : 'hidden'}>
              <label className="text-xs">{t('cfg.why')} (FR)<textarea name="why_fr" rows={2} defaultValue={i.why_fr ?? ''} className={inp} /></label>
              <label className="text-xs">{t('cfg.why')} (EN)<textarea name="why_en" rows={2} defaultValue={i.why_en ?? ''} className={inp} /></label>
              <fieldset className="md:col-span-2 text-xs"><legend className="font-semibold">{t('cfg.levers')}</legend><div className="mt-1 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4 max-h-48 overflow-auto">{cfg.levers.map((l: any) => <label key={l.code} className="flex items-start gap-1.5 py-0.5"><input type="checkbox" name="lever" value={l.code} defaultChecked={i.lever_codes.includes(l.code)} className="mt-0.5" />{l.name_fr}</label>)}</div></fieldset>
              {i.config_updated_at && <p className="text-[11px] opacity-70 md:col-span-2">{t('cfg.last')} {new Date(i.config_updated_at).toLocaleString()} · {i.config_updated_by}</p>}
            </div></form></li>))}</ul></>}

      {tab === 'lev' && <><p className="text-sm mt-2 max-w-3xl">{t('cfg.levHint')}</p><ul className="mt-2 space-y-2">{cfg.levers.map((l: any) => (
        <li key={l.code} className="card p-3"><form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save(() => put(`/admin/levers/${l.code}`, { description_fr: f.get('d'), impact_tco2e_ha_yr: f.get('i'), impact_source: f.get('s') })); }}>
          <div className="w-full md:w-64"><div className="font-semibold text-soil text-sm">{l.name_fr}</div><div className="text-xs opacity-70">{l.family}</div></div>
          <label className="text-xs flex-1 min-w-56">{t('cfg.desc')}<input name="d" defaultValue={l.description_fr ?? ''} className={inp} /></label>
          <label className="text-xs w-28">tCO₂e/ha/an<input name="i" type="number" step="any" defaultValue={l.impact_tco2e_ha_yr ?? ''} className={inp} /></label>
          <label className="text-xs w-40">{t('source')}<input name="s" defaultValue={l.impact_source ?? ''} className={inp} /></label><button className="btn !py-1.5">{t('cfg.save')}</button></form></li>))}</ul></>}

      {tab === 'blocks' && P && <><label className="block mt-3 text-sm font-medium">{t('f.project')}<select value={proj} onChange={e => setProj(e.target.value)} className={inp + ' max-w-xl block mt-1'}>{cfg.projects.map((p: any) => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label><p className="text-sm mt-2 max-w-3xl">{t('cfg.blocksHint')}</p>
        <ul className="mt-2 space-y-2" key={proj}>{BLOCKS.map((b, n) => { const v = P[`block_${b}`]; return (
          <li key={b} className="card p-3"><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); save(() => put(`/admin/projects/${proj}/blocks/${b}`, { content: f.get('c'), source: f.get('s'), verified_by: f.get('v') })); }}>
            <div className="font-semibold text-soil text-sm">{n + 1}. {t(`b.${b}`)} {!v && <span className="badge bg-wheat/30 ml-1">{t('tbd')}</span>}</div>
            <textarea name="c" rows={3} defaultValue={v?.content ?? ''} className={inp + ' mt-1'} aria-label={t(`b.${b}`)} />
            <div className="mt-1 flex flex-wrap items-end gap-3"><label className="text-xs flex-1 min-w-40">{t('source')}<input name="s" defaultValue={v?.source ?? ''} className={inp} /></label><label className="text-xs flex-1 min-w-40">{t('b.verifiedBy')}<input name="v" defaultValue={v?.verified_by ?? ''} className={inp} /></label><button className="btn !py-1.5">{t('cfg.save')}</button></div></form></li>); })}</ul></>}
    </section>
  );
}
