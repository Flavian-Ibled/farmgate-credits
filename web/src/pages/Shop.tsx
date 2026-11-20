// Purchase of remaining credits: checkout page, "Buy" button, order list (funder) and order desk (admin).
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, fmt } from '../api';
import { LoginForm } from './FunderPortal';

const O_COLOR: Record<string, string> = { awaiting_payment: '#DFAD0B', paid: '#377E25', cancelled: '#bec9b9', expired: '#bec9b9' };
export const OrderBadge = ({ s }: { s: string }) => { const { t } = useTranslation(); return <span className="badge" style={{ background: O_COLOR[s], color: s === 'paid' ? '#fff' : '#1e4414' }}>{t(`sh.st_${s}`)}</span>; };

/** "Buy these credits" button: shown only when something remains and a list price is set. */
export function BuyButton({ type, id, className = 'btn' }: { type: 'farm' | 'project'; id: string; className?: string }) {
  const { t } = useTranslation(); const [o, setO] = useState<any>(null);
  useEffect(() => { api(`/public/shop/${type}/${id}`).then(setO).catch(() => {}); }, [type, id]);
  if (!o?.open) return null;
  return <Link className={`${className} print:hidden`} to={`/acheter?type=${type}&id=${encodeURIComponent(id)}`}>{t('sh.buy')}</Link>;
}

function Instructions({ i }: { i: any }) {
  const { t } = useTranslation(); if (!i) return null; const b = i.bank ?? {};
  return <div className="rounded-xl bg-mist p-3 text-sm"><div className="font-bold text-soil">{t('sh.howToPay')}</div><dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5"><dt>{t('sh.amount')}</dt><dd className="font-bold tabular-nums">{fmt(i.amount_eur, 2)} € {t('sh.ht')}</dd><dt>{t('sh.label')}</dt><dd className="font-mono">{i.reference}</dd><dt>{t('sh.deadline')}</dt><dd>{new Date(i.due_date).toLocaleDateString()}</dd>
    <dt>{t('sh.holder')}</dt><dd>{b.holder ?? <span className="badge bg-wheat/40">{t('sh.onInvoice')}</span>}</dd><dt>IBAN</dt><dd className="font-mono">{b.iban ?? <span className="badge bg-wheat/40 font-sans">{t('sh.onInvoice')}</span>}</dd>{b.bic && <><dt>BIC</dt><dd className="font-mono">{b.bic}</dd></>}</dl><p className="text-xs mt-2 opacity-80">{i.note}</p></div>;
}

export function Checkout() {
  const { t, i18n } = useTranslation(); const [sp] = useSearchParams(); const type = sp.get('type') === 'project' ? 'project' : 'farm', id = sp.get('id') ?? '';
  const [me, setMe] = useState<any>(undefined), [o, setO] = useState<any>(null), [vol, setVol] = useState(''), [method, setMethod] = useState('transfer'), [ok, setOk] = useState(false), [res, setRes] = useState<any>(null), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const load = () => api('/auth/me').then(m => { setMe(m); if (m?.role?.startsWith('funder')) api(`/shop/offer/${type}/${id}`).then(x => { setO(x); setVol(String(Math.min(x.remaining, 100))); }).catch(e => setErr(e.message)); }).catch(() => setMe(null));
  useEffect(() => { load(); }, [type, id]);
  if (me === undefined) return <p className="p-8">{t('loading')}</p>;
  if (!me) return <div><p className="mx-auto max-w-sm mt-10 text-sm">{t('sh.loginFirst')}</p><LoginForm title={t('fo.title')} onDone={load} /></div>;
  if (!me.role.startsWith('funder')) return <p className="p-8">{t('sh.fundersOnly')}</p>;
  if (err && !o) return <p role="alert" className="p-8 text-red-700">{err}</p>; if (!o) return <p className="p-8">{t('loading')}</p>;
  const v = Number(vol.replace(',', '.')) || 0, total = o.price_eur != null ? Math.round(v * o.price_eur * 100) / 100 : null;
  if (res) return (
    <div className="mx-auto max-w-2xl px-4 py-10"><p className="text-xs font-bold uppercase tracking-widest text-leaf-dark">{t('sh.done')}</p><h1 className="text-2xl sm:text-3xl mt-1">{t('sh.orderRef', { ref: res.reference })}</h1>
      <p className="mt-3">{t('sh.doneText', { v: fmt(res.volume_tco2e), l: o.label, d: new Date(res.expires_at).toLocaleDateString() })}</p><div className="mt-4"><Instructions i={res.instructions} /></div>
      <div className="mt-5 flex gap-2"><Link className="btn" to="/financeur">{t('sh.myOrders')}</Link><Link className="btn-ghost" to={type === 'farm' ? `/fermes/${o.id}` : `/projets/${o.project_slug}`}>{t('sh.back')}</Link></div></div>);
  return (
    <div className="mx-auto max-w-2xl px-4 py-10"><p className="text-xs font-bold uppercase tracking-widest text-leaf-dark">{t('sh.kicker')}</p><h1 className="text-2xl sm:text-3xl mt-1">{o.label}</h1>{type === 'farm' && <p className="text-sm">{o.project}</p>}
      {!o.open ? <div className="card p-5 mt-4"><p>{t(`sh.closed_${o.reason}`)}</p><Link className="btn mt-3" to={`/carte?f=${encodeURIComponent(JSON.stringify(type === 'farm' ? { ids: [o.id] } : { project: [o.project] }))}`}>{t('fo.quote')}</Link></div> : (
        <form className="card p-5 mt-4 space-y-4" onSubmit={async e => { e.preventDefault(); setErr(''); setBusy(true); try { setRes(await api('/shop/orders', { type, id: o.id, volume_tco2e: v, method, accept_terms: ok })); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
          <div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-mist p-3"><div className="text-xs">{t('sh.remaining')}</div><div className="text-2xl font-bold text-soil tabular-nums">{fmt(o.remaining)} tCO₂e</div></div><div className="rounded-xl bg-mist p-3"><div className="text-xs">{t('sh.price')}</div><div className="text-2xl font-bold text-soil tabular-nums">{fmt(o.price_eur, 2)} € <span className="text-sm font-normal">/ tCO₂e {t('sh.ht')}</span></div></div></div>
          <label className="block text-sm font-medium">{t('sh.volume')}<input type="number" min="1" max={o.remaining} step="1" required className="mt-1 block w-40 border border-line rounded px-3 py-2 text-lg tabular-nums" value={vol} onChange={e => setVol(e.target.value)} /></label>
          <div className="text-lg">{t('sh.total')} : <strong className="tabular-nums">{total != null ? `${fmt(total, 2)} € ${t('sh.ht')}` : '—'}</strong>{type === 'project' && <span className="block text-xs opacity-75">{t('sh.spread')}</span>}</div>
          <fieldset><legend className="text-sm font-medium">{t('sh.method')}</legend>{o.providers.map((p: any) => <label key={p.id} className={`flex items-center gap-2 text-sm mt-1 ${p.enabled ? '' : 'opacity-50'}`}><input type="radio" name="m" value={p.id} disabled={!p.enabled} checked={method === p.id} onChange={() => setMethod(p.id)} />{i18n.language === 'en' ? p.label_en : p.label_fr}{!p.enabled && <span className="badge bg-line">{t('sh.soon')}</span>}</label>)}</fieldset>
          <p className="text-xs opacity-80">{t('sh.hold', { n: o.reservation_days })} {t('p.caution')}</p>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ok} onChange={e => setOk(e.target.checked)} /><span>{t('sh.terms')} <span className="badge bg-wheat/40">{t('sh.termsTbd')}</span></span></label>
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}<button className="btn w-full !py-3 text-base" disabled={busy || !ok || v < 1 || v > o.remaining}>{busy ? t('loading') : t('sh.confirm', { a: total != null ? fmt(total, 2) : '—' })}</button></form>)}
    </div>);
}

/** funder portal: my orders */
export function MyOrders() {
  const { t } = useTranslation(); const [rows, setRows] = useState<any[] | null>(null), [open, setOpen] = useState<number | null>(null);
  const load = () => api('/shop/orders').then(setRows).catch(() => setRows([])); useEffect(() => { load(); }, []);
  if (!rows || rows.length === 0) return null;
  return <><h2 className="text-xl mt-8">{t('sh.myOrders')}</h2><div className="card mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b border-line">{[t('sh.ref'), t('af.target'), 'tCO₂e', '€', t('al.label'), t('sh.deadline'), ''].map((h, i) => <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
    <tbody>{rows.map(o => <><tr key={o.id} className="border-b border-line"><td className="px-3 py-1.5 font-mono">{o.reference}</td><td className="px-3">{o.target_label}</td><td className="px-3 tabular-nums">{fmt(Number(o.volume_tco2e))}</td><td className="px-3 tabular-nums">{fmt(Number(o.amount_eur), 2)}</td><td className="px-3"><OrderBadge s={o.status} /></td><td className="px-3">{o.status === 'awaiting_payment' ? new Date(o.expires_at).toLocaleDateString() : o.paid_at ? new Date(o.paid_at).toLocaleDateString() : '—'}</td>
      <td className="px-3 py-1 whitespace-nowrap">{o.status === 'awaiting_payment' && <><button className="btn-ghost !py-0.5 text-xs mr-1" onClick={() => setOpen(open === o.id ? null : o.id)}>{t('sh.howToPay')}</button><button className="btn-ghost !py-0.5 text-xs" onClick={async () => { if (confirm(t('sh.cancelConfirm'))) { await api(`/shop/orders/${o.id}/cancel`, {}); load(); } }}>{t('sh.cancel')}</button></>}{o.status === 'paid' && <Link className="underline text-xs" to={`/certificat/${o.allocation_reference}`}>{t('fo.cert')}</Link>}</td></tr>
      {open === o.id && <tr key={`${o.id}-i`}><td colSpan={7} className="px-3 py-2"><Instructions i={o.instructions} /></td></tr>}</>)}</tbody></table></div></>;
}

/** admin: orders desk + list price per project */
export function AdminOrders({ projects }: { projects: any[] }) {
  const { t } = useTranslation(); const [rows, setRows] = useState<any[]>([]), [msg, setMsg] = useState(''), [slug, setSlug] = useState(''), [price, setPrice] = useState<string>('');
  const load = () => api('/admin/orders').then(setRows).catch(() => {}); useEffect(() => { load(); }, []);
  useEffect(() => { if (!slug && projects[0]) setSlug(projects[0].slug); }, [projects]);
  useEffect(() => { if (slug) api(`/admin/projects/${slug}/money`).then(p => setPrice(p.list_price_eur ?? '')).catch(() => {}); }, [slug]);
  const act = async (fn: () => Promise<any>, ok: string) => { setMsg(''); try { await fn(); setMsg(ok); load(); } catch (e: any) { setMsg(e.message); } };
  return (
    <section className="mt-8"><h2 className="text-xl font-bold">{t('sh.adminTitle')}</h2><p className="text-sm mt-1 max-w-3xl">{t('sh.adminHint')}</p>{msg && <p role="status" className="mt-2 text-sm font-medium">{msg}</p>}
      <form className="card p-4 mt-2 flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); act(() => api(`/admin/projects/${slug}/price`, { list_price_eur: price }, { method: 'PUT' }), t('cfg.saved')); }}>
        <label className="text-xs font-medium flex-1 min-w-48">{t('f.project')}<select className="block mt-1 w-full border border-line rounded px-2 py-1 text-sm bg-white" value={slug} onChange={e => setSlug(e.target.value)}>{projects.map(p => <option key={p.slug} value={p.slug}>{p.name}</option>)}</select></label>
        <label className="text-xs font-medium">{t('sh.listPrice')}<input type="number" step="any" min="0" className="block mt-1 w-28 border border-line rounded px-2 py-1 text-sm" value={price} onChange={e => setPrice(e.target.value)} placeholder={t('sh.notForSale')} /></label><button className="btn !py-1.5">{t('cfg.save')}</button><span className="text-xs opacity-75 max-w-xs">{t('sh.priceHint')}</span></form>
      <div className="card mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b border-line">{[t('sh.ref'), t('af.org'), t('af.target'), 'tCO₂e', '€', t('al.label'), t('sh.deadline'), ''].map((h, i) => <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{rows.length === 0 && <tr><td colSpan={8} className="px-3 py-3">{t('sh.none')}</td></tr>}{rows.map(o => <tr key={o.id} className="border-b border-line last:border-0"><td className="px-3 py-1.5 font-mono">{o.reference}</td><td className="px-3">{o.funder}</td><td className="px-3">{o.target_label}</td><td className="px-3 tabular-nums">{fmt(Number(o.volume_tco2e))}</td><td className="px-3 tabular-nums">{fmt(Number(o.amount_eur), 2)}</td><td className="px-3"><OrderBadge s={o.status} /></td><td className="px-3">{o.expires_at ? new Date(o.expires_at).toLocaleDateString() : '—'}</td>
          <td className="px-3 py-1 whitespace-nowrap">{o.status === 'awaiting_payment' && <><button className="btn !py-0.5 !px-2 text-xs mr-1" onClick={() => { if (confirm(t('sh.paidConfirm', { ref: o.reference, a: fmt(Number(o.amount_eur), 2) }))) act(() => api(`/admin/orders/${o.id}/paid`, {}), t('sh.paidDone')); }}>{t('sh.markPaid')}</button><button className="btn-ghost !py-0.5 !px-2 text-xs" onClick={() => { if (confirm(t('sh.cancelConfirm'))) act(() => api(`/admin/orders/${o.id}/cancel`, {}), t('cfg.saved')); }}>{t('sh.cancel')}</button></>}</td></tr>)}</tbody></table></div>
    </section>);
}
