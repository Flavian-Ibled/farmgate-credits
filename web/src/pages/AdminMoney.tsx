// Admin: remuneration model and social / territorial co-benefits of a project.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { MoneyFlow } from '../components/Sheet';

const inp = 'border border-line rounded px-2 py-1 text-sm bg-white';
const REST = ['mrv_pct', 'support_pct', 'cf_pct', 'partner_pct', 'label_pct'], SOCIAL = ['jobs', 'income_resilience', 'local_supply_chain', 'training', 'partner_engagement'];
export default function AdminMoney({ projects }: { projects: any[] }) {
  const { t } = useTranslation(); const [slug, setSlug] = useState(''), [p, setP] = useState<any>(null), [msg, setMsg] = useState('');
  const load = (s = slug) => { if (!s) return; setMsg(''); api(`/admin/projects/${s}/money`).then(setP).catch(e => setMsg(e.message)); };
  useEffect(() => { if (!slug && projects[0]) { setSlug(projects[0].slug); load(projects[0].slug); } }, [projects]);
  const save = async (path: string, e: any) => { e.preventDefault(); setMsg(''); try { await api(`/admin/projects/${slug}/${path}`, Object.fromEntries(new FormData(e.currentTarget).entries()), { method: 'PUT' }); setMsg(t('cfg.saved')); load(); } catch (x: any) { setMsg(x.message); } };
  const r = p?.remuneration ?? {}, s = p?.social ?? {};
  return (
    <section className="mt-8"><h2 className="text-xl font-bold">{t('mo.title')}</h2><p className="text-sm mt-1 max-w-3xl">{t('mo.hint')}</p>
      <label className="block mt-2 text-sm font-medium">{t('f.project')}<select className={inp + ' block mt-1 w-full max-w-xl'} value={slug} onChange={e => { setSlug(e.target.value); load(e.target.value); }}>{projects.map(x => <option key={x.slug} value={x.slug}>{x.name}</option>)}</select></label>
      {msg && <p role="status" className="mt-2 text-sm font-medium">{msg}</p>}
      {p && <div className="grid lg:grid-cols-2 gap-3 mt-2" key={slug + JSON.stringify(p.remuneration) + JSON.stringify(p.social)}>
        <form className="card p-4" onSubmit={e => save('remuneration', e)}><h3 className="text-base">{t('mo.model')} {!p.remuneration && <span className="badge bg-mist ml-1">{t('mo.default')}</span>}</h3>
          <div className="grid grid-cols-2 gap-2 mt-2"><label className="text-xs">{t('mo.farmer')}<input name="farmer_pct" type="number" step="any" min="75" max="100" defaultValue={r.farmer_pct ?? ''} placeholder="75" className={inp + ' w-full'} /></label><label className="text-xs">{t('mo.advice')}<input name="advice_pct" type="number" step="any" min="0" defaultValue={r.advice_pct || ''} placeholder="0" className={inp + ' w-full'} /></label>
            {REST.map(k => <label key={k} className="text-xs">{t(`mo.${k.replace('_pct', '')}`)} (%)<input name={k} type="number" step="any" min="0" defaultValue={r[k] ?? ''} className={inp + ' w-full'} /></label>)}<label className="text-xs col-span-2">{t('mo.note')}<input name="note" defaultValue={r.note ?? ''} className={inp + ' w-full'} /></label></div>
          <p className="text-xs opacity-75 mt-2">{t('mo.rule')}</p><div className="mt-3"><MoneyFlow r={p.effective} /></div><button className="btn mt-3">{t('cfg.save')}</button></form>
        <form className="card p-4" onSubmit={e => save('social', e)}><h3 className="text-base">{t('so.title')}</h3><p className="text-xs opacity-75">{t('so.hint')}</p>
          {SOCIAL.map(k => <label key={k} className="text-xs block mt-2">{t(`so.${k}`)}<textarea name={k} rows={2} defaultValue={s[k] ?? ''} className={inp + ' w-full'} /></label>)}
          <div className="grid grid-cols-2 gap-2 mt-2"><label className="text-xs">{t('source')}<input name="source" defaultValue={s.source ?? ''} className={inp + ' w-full'} /></label><label className="text-xs">{t('b.verifiedBy')}<input name="verified_by" defaultValue={s.verified_by ?? ''} className={inp + ' w-full'} /></label></div><button className="btn mt-3">{t('cfg.save')}</button></form>
      </div>}
    </section>
  );
}
