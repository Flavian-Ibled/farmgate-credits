// Choose which co-benefits are displayed on a project page or a farm sheet.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, fmt, pct, share } from '../api';
import { TREND } from './FarmPage';
import { IndIcon } from '../components/Icons';

const inp = 'border border-line rounded px-2 py-1 text-sm bg-white';
export default function AdminVisibility({ projects }: { projects: any[] }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<'project' | 'farm' | 'global'>('project'), [slug, setSlug] = useState(''), [farm, setFarm] = useState(''), [v, setV] = useState<any>(null), [hidden, setHidden] = useState<string[]>([]), [msg, setMsg] = useState('');
  const load = async () => { setMsg(''); setV(null); try { const id = kind === 'project' ? slug || projects[0]?.slug : farm.trim(); const r = await api(kind === 'global' ? '/admin/portfolio-visibility' : `/admin/visibility/${kind}/${id}`); setV(r); setHidden(r.hidden); } catch (e: any) { setMsg(e.message); } };
  const save = async () => { try { await api(v.kind === 'global' ? '/admin/portfolio-visibility' : `/admin/visibility/${v.kind}/${v.id}`, { hidden }, { method: 'PUT' }); setMsg(t('cfg.saved')); } catch (e: any) { setMsg(e.message); } };
  const worse = v ? v.items.filter((i: any) => i.trend === 'worse').map((i: any) => i.code) : [];
  return (
    <section className="mt-8"><h2 className="text-xl font-bold">{t('vi.title')}</h2><p className="text-sm mt-1 max-w-3xl">{t('vi.hint')}</p>
      <form className="card p-4 mt-2 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); load(); }}>
        <label className="text-sm font-medium">{t('vi.on')}<select className={inp + ' block mt-1'} value={kind} onChange={e => { setKind(e.target.value as any); setV(null); }}><option value="project">{t('f.project')}</option><option value="farm">{t('list.id')}</option><option value="global">{t('p8.portfolio')}</option></select></label>
        {kind === 'global' ? <span className="flex-1 text-sm">{t('p8.portfolioTitle')}</span> : kind === 'project' ? <label className="text-sm font-medium flex-1 min-w-56">{t('f.project')}<select className={inp + ' block w-full mt-1'} value={slug} onChange={e => setSlug(e.target.value)}>{projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label> : <label className="text-sm font-medium">{t('fs.farmId')}<input className={inp + ' block mt-1 w-36'} placeholder="CVL2-063" value={farm} onChange={e => setFarm(e.target.value)} required /></label>}
        <button className="btn">{t('fs.open')}</button></form>
      {msg && <p role="status" className="mt-2 text-sm font-medium">{msg}</p>}
      {v && <div className="card p-4 mt-2">
        <div className="flex flex-wrap items-center gap-2"><strong className="text-soil mr-auto">{v.name}</strong><span className="text-sm">{t('fp3.cobShown', { n: v.items.length - v.items.filter((i: any) => hidden.includes(i.code) || v.inherited.includes(i.code)).length, t: v.items.length })}</span>
          {worse.length > 0 && <button className="btn-ghost" onClick={() => setHidden([...new Set([...hidden, ...worse])])}>{t('vi.hideWorse', { n: worse.length })}</button>}<button className="btn-ghost" onClick={() => setHidden([])}>{t('vi.showAll')}</button><button className="btn !py-1.5" onClick={save}>{t('cfg.save')}</button></div>
        {v.items.length === 0 ? <p className="text-sm mt-2">{t('s.notCollected')}</p> : <table className="w-full text-sm mt-2"><thead><tr className="text-left border-b border-line"><th className="py-1.5 font-semibold">{t('vi.show')}</th><th className="font-semibold">{t('s.indicator')}</th><th className="font-semibold text-right">{t('s.init')}</th><th className="font-semibold text-right">{t('p.target')}</th><th className="font-semibold text-right">{t('s.evol')}</th><th className="font-semibold pl-3">{t('vi.trend')}</th></tr></thead>
          <tbody>{v.items.map((i: any) => { const sh = i.unit === 'part de SAU'; const f = (x: number | null) => (x == null ? '—' : sh ? share(x, 1) : fmt(x, Math.abs(x) < 100 ? 2 : 0)); const inh = v.inherited.includes(i.code); return (
            <tr key={i.code} className={`border-b border-line last:border-0 ${hidden.includes(i.code) || inh ? 'opacity-50' : ''}`}><td className="py-1.5"><input type="checkbox" aria-label={i.label_fr} disabled={inh} checked={!hidden.includes(i.code) && !inh} onChange={e => setHidden(e.target.checked ? hidden.filter(x => x !== i.code) : [...hidden, i.code])} /></td><td><IndIcon code={i.code} size={20} /> <span className="font-medium">{i.label_fr}</span> <span className="text-xs opacity-60">{i.category}{inh ? ` · ${t('vi.inherited')}` : ''}</span></td><td className="text-right tabular-nums">{f(i.initial)}</td><td className="text-right tabular-nums">{f(i.prospectif)}</td><td className="text-right tabular-nums font-semibold">{pct(i.evolution)}</td>
              <td className="pl-3 text-xs font-bold" style={{ color: i.trend ? TREND[i.trend as keyof typeof TREND] : '#888' }}>{i.trend ? t(`vi.${i.trend}`) : t('vi.unknown')}</td></tr>); })}</tbody></table>}
      </div>}
    </section>
  );
}
