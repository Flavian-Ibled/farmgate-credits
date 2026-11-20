// Funder portal ("Mon portefeuille"), certificate / ledger verification page, invitation acceptance.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { api, fmt, share } from '../api';
import { Tile, PdfButton, isPrint } from '../components/Sheet';
import { AL_COLOR } from './AdminFunders';
import { MyOrders } from './Shop';

function MySelections() {
  const { t } = useTranslation(); const [rows, setRows] = useState<any[]>([]); useEffect(() => { api('/funder/selections').then(setRows).catch(() => {}); }, []);
  if (!rows.length) return null;
  return <><h2 className="text-xl mt-8">{t('fd.mine')}</h2><p className="text-sm">{t('fd.mineHint')}</p><div className="grid md:grid-cols-2 gap-3 mt-2">{rows.map(s => <section key={s.id} className="card p-4"><h3 className="text-base">{s.name}</h3>{s.note && <p className="text-sm mt-1">{s.note}</p>}<p className="mt-2 text-sm tabular-nums"><strong>{fmt(s.farms)}</strong> {t('kpi.farms')} · <strong>{fmt(s.sau)}</strong> ha · <strong>{fmt(s.remaining)}</strong> tCO₂e {t('fd.remaining')}</p><p className="text-[11px] opacity-70 mt-1 break-words">{s.sample.map((f: any) => f.id).join(', ')}{s.farms > s.sample.length ? '…' : ''}</p><div className="mt-2 flex gap-2"><Link className="btn" to={`/carte?f=${encodeURIComponent(JSON.stringify({ ids: s.ids }))}`}>{t('fd.open')}</Link><Link className="btn-ghost" to={`/selection?f=${encodeURIComponent(JSON.stringify({ ids: s.ids }))}`}>{t('fd.rank')}</Link></div></section>)}</div></>;
}

export function LoginForm({ onDone, title }: { onDone: () => void; title: string }) {
  const { t } = useTranslation(); const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  return <form className="mx-auto max-w-sm card p-6 mt-16" onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setErr(''); try { await api('/auth/login', { email: f.get('email'), password: f.get('password') }); onDone(); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
    <h1 className="text-2xl font-bold">{title}</h1><label className="block mt-4 text-sm font-medium">{t('adm.email')}<input name="email" type="email" required autoComplete="username" className="mt-1 w-full border border-line rounded px-3 py-2" /></label>
    <label className="block mt-3 text-sm font-medium">{t('adm.password')}<input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full border border-line rounded px-3 py-2" /></label>{err && <p role="alert" className="mt-3 text-sm text-red-700">{err}</p>}<button className="btn mt-4 w-full" disabled={busy}>{t('adm.signin')}</button></form>;
}
const Badge = ({ s }: { s: string }) => { const { t } = useTranslation(); return <span className="badge" style={{ background: AL_COLOR[s], color: s === 'quote' || s === 'cancelled' ? '#1e4414' : '#fff' }}>{t(`al.${s}`)}</span>; };

export default function FunderPortal() {
  const { t } = useTranslation(); const [me, setMe] = useState<any>(undefined), [p, setP] = useState<any>(null), [err, setErr] = useState('');
  const load = () => api('/auth/me').then(m => { setMe(m); if (m && m.role.startsWith('funder')) api('/funder/portfolio').then(setP).catch(e => setErr(e.message)); }).catch(() => setMe(null));
  useEffect(() => { load(); }, []);
  if (me === undefined) return <p className="p-8">{t('loading')}</p>;
  if (!me) return <LoginForm title={t('fo.title')} onDone={load} />;
  if (!me.role.startsWith('funder')) return <p className="p-8">{t('fo.notFunder')} <button className="underline" onClick={async () => { await api('/auth/logout', {}); setMe(null); }}>{t('adm.signout')}</button></p>;
  if (err) return <p role="alert" className="p-8 text-red-700">{err}</p>; if (!p) return <p className="p-8">{t('loading')}</p>;
  const T = p.totals;
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
      <div className="flex flex-wrap items-center gap-3"><div className="mr-auto"><p className="text-xs font-bold uppercase tracking-widest text-leaf-dark">{t('fo.title')}</p><h1 className="text-2xl sm:text-4xl">{p.organization.name}</h1></div><Link className="btn" to="/carte">{t('fo.browse')}</Link><button className="btn-ghost" onClick={async () => { await api('/auth/logout', {}); setMe(null); setP(null); }}>{t('adm.signout')}</button></div>
      <section className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3"><Tile value={fmt(T.funded)} label={t('fo.funded')} sub={t('fo.planned')} /><Tile tone="apple" value={T.farms_measured ? fmt(T.measured_attributed) : '—'} label={t('fo.measured')} sub={T.farms_measured ? t('fo.measuredSub', { n: T.farms_measured }) : t('p.noFollowup')} /><Tile tone="brown" value={fmt(T.farms)} label={t('fo.farms')} sub={`${T.projects} ${t('s.projects')} · ${fmt(T.sau_attributed)} ha ${t('fo.attr')}`} /><Tile tone="brown" value={T.amount_eur ? `${fmt(T.amount_eur)} €` : '—'} label={t('fo.amount')} sub={T.farmer_amount_eur ? `${fmt(T.farmer_amount_eur)} € ${t('mo.toFarmers')}` : undefined} /></section>
      <p className="text-xs opacity-75 mt-2">{t('fo.attrNote')} {t('p.caution')}</p>

      <MySelections />
      <MyOrders />
      <h2 className="text-xl mt-8">{t('fo.allocs')}</h2>
      <div className="card mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b border-line">{[t('af.ref'), t('af.target'), 'tCO₂e', '€/tCO₂e', '€', t('mo.pctAgri'), t('al.label'), t('fo.cert')].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead><tbody>{p.allocations.length === 0 && <tr><td colSpan={8} className="px-3 py-3">{t('fo.none')}</td></tr>}{p.allocations.map((a: any) => <tr key={a.id} className="border-b border-line last:border-0"><td className="px-3 py-1.5 font-medium">{a.reference}</td><td className="px-3">{a.target_type === 'portfolio' ? t('af.selection') : a.target_id}</td><td className="px-3 tabular-nums">{fmt(a.volume_tco2e)}</td><td className="px-3 tabular-nums">{a.price_per_tco2e != null ? fmt(a.price_per_tco2e, 2) : '—'}</td><td className="px-3 tabular-nums">{a.amount_eur != null ? fmt(a.amount_eur) : '—'}</td><td className="px-3 tabular-nums">{fmt(a.farmer_pct, a.farmer_pct % 1 ? 1 : 0)} %{a.advice_pct > 0 && <span className="block text-[11px] opacity-70">{t('mo.inclAdvice', { p: fmt(a.advice_pct, 1) })}</span>}{a.farmer_amount_eur != null && <span className="block text-[11px] opacity-70">{fmt(a.farmer_amount_eur)} €</span>}</td><td className="px-3"><Badge s={a.status} /></td><td className="px-3">{['contracted', 'paid', 'delivered', 'retired'].includes(a.status) ? <Link className="underline" to={`/certificat/${a.reference}`}>{t('fo.open')}</Link> : '—'}</td></tr>)}</tbody></table></div>

      <h2 className="text-xl mt-8">{t('fo.myFarms')}</h2>
      <div className="card mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b border-line">{[t('list.id'), t('f.project'), t('f.departement'), t('fo.myVol'), t('fo.myShare'), t('fo.measuredShort'), t('fo.estimate'), t('fo.left')].map(h => <th key={h} className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{p.farms.map((f: any) => <tr key={f.id} className="border-b border-line last:border-0"><td className="px-3 py-1.5 font-medium"><Link className="underline" to={`/fermes/${f.id}`}>{f.id}</Link></td><td className="px-3">{f.project}</td><td className="px-3">{f.departement}</td><td className="px-3 tabular-nums font-semibold">{fmt(f.my_volume)}</td><td className="px-3 tabular-nums">{share(f.share, 1)}</td><td className="px-3 tabular-nums">{fmt(f.attributed?.measured)}</td><td className="px-3 tabular-nums">{fmt(f.attributed?.end_estimate)}</td><td className="px-3 tabular-nums">{fmt(f.remaining)}</td></tr>)}</tbody></table></div>
    </div>
  );
}

export function Certificate() {
  const { reference } = useParams(); const { t } = useTranslation(); const [c, setC] = useState<any>(null), [err, setErr] = useState(''), [qr, setQr] = useState('');
  const url = `${location.origin}/certificat/${reference}`;
  useEffect(() => { api(`/public/ledger/${reference}`).then(setC).catch(e => setErr(e.message)); QRCode.toDataURL(url, { margin: 0, width: 220, color: { dark: '#1e4414', light: '#ffffff' } }).then(setQr).catch(() => {}); }, [reference]);
  if (err) return <div className="mx-auto max-w-xl p-8 text-center"><h1 className="text-2xl">{t('ce.unknown')}</h1><p className="mt-2">{reference}</p></div>; if (!c) return <p className="p-8">{t('loading')}</p>;
  const funderLabel = c.funder ?? (c.funder_visibility === 'unassigned' ? t('ce.unassigned') : t('ce.confidential'));
  return (
    <article className="mx-auto max-w-3xl px-4 py-6 sm:py-10 print:py-0">
      <div className="flex justify-end print:hidden mb-3"><PdfButton path={`/certificat/${reference}`} /></div>
      <div className="rounded-2xl border-4 border-line bg-white p-6 sm:p-10 text-center">
        {!isPrint() && <img src="/brand/logo.svg" alt="Carbone Farmers" className="h-12 mx-auto" />}
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.3em] text-leaf">{c.kind === 'historical_sale' ? t('ce.kHist') : t('ce.kicker')}</p>
        <h1 className="mt-2 text-2xl sm:text-3xl">{funderLabel}</h1>
        <div className="mt-6 inline-block rounded-2xl bg-soil text-white px-8 py-5"><div className="text-5xl font-bold tabular-nums">{fmt(c.volume_tco2e)}</div><div className="text-sm mt-1">tCO₂e · {c.label}</div></div>
        <dl className="mt-6 grid sm:grid-cols-2 gap-x-8 text-sm text-left max-w-xl mx-auto">{([[t('af.ref'), c.reference], [t('al.label'), <><span className="badge" style={{ background: AL_COLOR[c.status], color: c.status === 'quote' || c.status === 'cancelled' ? '#1e4414' : '#fff' }}>{t(`al.${c.status}`)}</span>{!c.valid && <span className="ml-2 text-red-700 font-bold">{t('ce.notValid')}</span>}</>], [t('ce.vintage'), c.vintage_scope === 'all' ? t('ce.all5') : c.vintage_scope], [t('ce.date'), c.signed_at ?? c.created_at], [t('home.projects'), c.project_names ?? '—'], [t('kpi.farms'), c.farms]] as [string, any][]).map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-1.5 border-b border-line"><dt className="opacity-75">{k}</dt><dd className="font-semibold text-right">{v}</dd></div>)}</dl>
        <div className="mt-6 text-sm max-w-xl mx-auto"><p className="font-bold text-soil">{t('ce.claim')}</p><p className="mt-1">{c.claim_wording ?? <><span className="badge bg-wheat/40">à valider · Carbone Farmers / juridique</span> {t('ce.claimTbd')}</>}</p></div>
        <div className="mt-6 flex items-center justify-center gap-4 text-left">{qr && <img src={qr} alt={`QR code : ${url}`} className="w-24 h-24" />}<div className="text-xs max-w-xs"><p className="font-bold text-soil">{t('ce.verify')}</p><p className="break-all">{url}</p><p className="mt-1 opacity-75">{t('ce.planned')} {t('p.caution')}</p></div></div>
      </div>
    </article>
  );
}

export function Invitation() {
  const { token } = useParams(); const { t } = useTranslation(); const [i, setI] = useState<any>(null), [err, setErr] = useState(''), [done, setDone] = useState(false);
  useEffect(() => { api(`/public/invitations/${token}`).then(setI).catch(e => setErr(e.message)); }, [token]);
  if (done) return <div className="mx-auto max-w-sm card p-6 mt-16"><h1 className="text-xl">{t('in.done')}</h1><Link className="btn mt-4" to="/financeur">{t('fo.title')}</Link></div>;
  if (err && !i) return <p role="alert" className="p-8 text-red-700">{err}</p>; if (!i) return <p className="p-8">{t('loading')}</p>;
  return <form className="mx-auto max-w-sm card p-6 mt-16" onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); setErr(''); if (f.get('password') !== f.get('password2')) return setErr(t('in.mismatch')); try { await api(`/public/invitations/${token}/accept`, { password: f.get('password'), first_name: f.get('first_name'), last_name: f.get('last_name') }); setDone(true); } catch (x: any) { setErr(x.message); } }}>
    <h1 className="text-xl">{t('in.title', { org: i.organization })}</h1><p className="text-sm mt-1">{i.email}</p>
    <div className="grid grid-cols-2 gap-2 mt-4"><label className="text-sm">{t('in.first')}<input name="first_name" autoComplete="given-name" className="mt-1 w-full border border-line rounded px-2 py-1.5" /></label><label className="text-sm">{t('in.last')}<input name="last_name" autoComplete="family-name" className="mt-1 w-full border border-line rounded px-2 py-1.5" /></label></div>
    <label className="block mt-3 text-sm">{t('in.pw')}<input name="password" type="password" minLength={12} required autoComplete="new-password" className="mt-1 w-full border border-line rounded px-2 py-1.5" /></label><label className="block mt-3 text-sm">{t('in.pw2')}<input name="password2" type="password" minLength={12} required autoComplete="new-password" className="mt-1 w-full border border-line rounded px-2 py-1.5" /></label>
    {err && <p role="alert" className="mt-3 text-sm text-red-700">{err}</p>}<button className="btn mt-4 w-full">{t('in.create')}</button></form>;
}
