// Shared building blocks of the project and farm pages (also used by the print / PDF layout).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { fmt, pct, share } from '../api';
import { CatIcon, IndIcon } from './Icons';

export const RATING_COLORS = ['#9A3333', '#C8792B', '#DFAD0B', '#83B56E', '#377E25'];
const cls = (r: number | null) => (r == null ? null : Math.min(4, Math.floor(r / 20)));
export const isPrint = () => new URLSearchParams(location.search).get('print') === '1';

export function Tbd({ owner }: { owner?: string }) { const { t } = useTranslation(); return <span className="badge bg-wheat/30 text-ink">{t('tbd')}{owner ? ` · ${owner}` : ''}</span>; }
export function Tile({ value, label, sub, tone = 'soil' }: { value: string; label: string; sub?: string; tone?: 'soil' | 'apple' | 'brown' }) {
  const bg = { soil: 'bg-soil text-white', apple: 'bg-apple text-white', brown: 'bg-white text-soil border border-line' }[tone];
  return <div className={`rounded-2xl p-4 ${bg}`}><div className="text-2xl sm:text-3xl font-bold tabular-nums leading-tight">{value}</div><div className="text-sm mt-1 opacity-95">{label}</div>{sub && <div className="text-xs mt-1 opacity-80">{sub}</div>}</div>;
}
export function Dot({ r, title }: { r: number | null; title?: string }) {
  const c = cls(r);
  return <span title={title} className="inline-flex items-center gap-1.5 align-middle"><span aria-hidden className="inline-block w-3.5 h-3.5 rounded-full border border-black/10" style={{ background: c == null ? '#e5e7eb' : RATING_COLORS[c] }} />{r != null && <span className="text-xs tabular-nums">{Math.round(r)}</span>}</span>;
}
/** Avoidance / storage split as a pie chart, with its legend (falls back to nothing when a value is negative). */
export function Pie({ avoid, store, caption }: { avoid: number; store: number; caption?: string }) {
  const { t } = useTranslation(); const tot = avoid + store; if (!(tot > 0) || avoid < 0 || store < 0) return null;
  const p = avoid / tot, r = 44, a = p * 2 * Math.PI, x = 50 + r * Math.sin(a), y = 50 - r * Math.cos(a), A = '#529a38', S = '#C8994F';
  return (
    <figure className="flex items-center gap-4 break-inside-avoid" aria-label={`${t('s.avoid')} ${share(p)}, ${t('s.storage')} ${share(1 - p)}`}>
      <svg viewBox="0 0 100 100" className="w-28 h-28 shrink-0" role="img" aria-hidden><circle cx="50" cy="50" r={r} fill={p >= 0.9995 ? A : S} />{p > 0.0005 && p < 0.9995 && <path d={`M50 50 L50 ${50 - r} A${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${x} ${y} Z`} fill={A} />}</svg>
      <figcaption className="text-sm space-y-1"><div><span className="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style={{ background: A }} /><strong className="tabular-nums">{share(p)}</strong> {t('s.avoid').toLowerCase()} · {fmt(avoid)} tCO₂e</div><div><span className="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style={{ background: S }} /><strong className="tabular-nums">{share(1 - p)}</strong> {t('s.storage').toLowerCase()} · {fmt(store)} tCO₂e</div>{caption && <div className="text-[11px] opacity-75">{caption}</div>}</figcaption>
    </figure>
  );
}
const FLOW_COLOR: Record<string, string> = { farmer_paid: '#1e4414', advice: '#529a38', mrv: '#885104', support: '#a06e36', cf: '#C8994F', partner: '#517DA5', label: '#8AA7C2', undocumented: '#cfd6cc' };
/** "Where the money goes": flow of one tonne's price (Sankey-style), with a text list as fallback. Undocumented parts stay grey. */
export function MoneyFlow({ r, amount }: { r: { flows: { key: string; pct: number; known: boolean }[]; farmer_pct: number; advice_pct: number; source: string; note?: string | null }; amount?: number | null }) {
  const { t } = useTranslation(); const H = 200, gap = 6, fl = r.flows.filter(f => f.pct > 0); const scale = (H - gap * (fl.length - 1)) / 100; let yL = 0, yR = 0;
  const bands = fl.map(f => { const hL = (f.pct / 100) * H, hR = f.pct * scale, b = { ...f, yL, hL, yR, hR }; yL += hL; yR += hR + gap; return b; });
  return (
    <figure className="break-inside-avoid"><svg viewBox="0 0 560 210" className="w-full h-auto" role="img" aria-label={fl.map(f => `${t(`mo.f_${f.key}`)} ${f.pct} %`).join(', ')}>
      <rect x="0" y="5" width="22" height={H} rx="4" fill="#1e4414" /><text x="30" y="20" fontSize="12" fontWeight="700" fill="#1e4414">{t('mo.tonne')}</text><text x="30" y="36" fontSize="11" fill="#404040">100 %</text>
      {bands.map(b => <g key={b.key}><path d={`M22 ${5 + b.yL} C150 ${5 + b.yL} 150 ${5 + b.yR} 270 ${5 + b.yR} L270 ${5 + b.yR + b.hR} C150 ${5 + b.yR + b.hR} 150 ${5 + b.yL + b.hL} 22 ${5 + b.yL + b.hL} Z`} fill={FLOW_COLOR[b.key] ?? '#999'} opacity={b.known ? 0.35 : 0.25} /><rect x="270" y={5 + b.yR} width="18" height={Math.max(2, b.hR)} rx="3" fill={FLOW_COLOR[b.key] ?? '#999'} />
        <text x="296" y={5 + b.yR + Math.min(b.hR / 2 + 4, 14)} fontSize="12" fontWeight="700" fill="#1e4414">{fmt(b.pct, b.pct % 1 ? 1 : 0)} %{amount != null ? ` · ${fmt((amount * b.pct) / 100)} €` : ''}</text><text x="296" y={5 + b.yR + Math.min(b.hR / 2 + 4, 14) + 13} fontSize="10.5" fill="#404040">{t(`mo.f_${b.key}`)}</text></g>)}
    </svg><figcaption className="text-[11px] opacity-80 mt-1">{t(`mo.src_${r.source}`)}{r.flows.some(f => !f.known) ? ` ${t('mo.restTbd')}` : ''}{r.note ? ` ${r.note}` : ''}</figcaption></figure>
  );
}
export function Scale() { const { t } = useTranslation(); return <span className="inline-flex items-center gap-1 text-xs" aria-label={t('p.scale')}>{t('p.low')}{RATING_COLORS.map(c => <span key={c} className="inline-block w-5 h-2.5 rounded-sm" style={{ background: c }} />)}{t('p.high')}</span>; }

/** "Initial label / already generated / end-of-project estimate" — always three numbers, with a data-table fallback. */
export function Trajectory({ initial, generated, estimate, year, followed, formula }: { initial: number | null; generated: number | null; estimate: number | null; year?: number; followed?: string; formula?: string }) {
  const { t } = useTranslation();
  const bars = [{ k: t('p.tInitial'), v: initial, c: '#1e4414', b: t('status.estimated') }, { k: `${t('p.tGenerated')}${year ? ` (R${String(year).slice(2)})` : ''}`, v: generated, c: '#529a38', b: t('status.measured') }, { k: t('p.tEstimate'), v: estimate, c: '#C8994F', b: t('p.projection') }];
  const max = Math.max(1, ...bars.map(b => Math.abs(b.v ?? 0)));
  const delta = initial && estimate != null ? estimate / initial - 1 : null;
  return (
    <figure className="card p-4 sm:p-5 break-inside-avoid">
      <figcaption className="font-bold text-soil">{t('p.trajectory')}</figcaption>
      <div className="mt-4 grid grid-cols-3 gap-3 items-end h-44" role="img" aria-label={bars.map(b => `${b.k}: ${fmt(b.v)} tCO₂e`).join(', ')}>
        {bars.map(b => <div key={b.k} className="h-full flex flex-col justify-end items-center"><div className="font-bold tabular-nums text-soil text-sm sm:text-lg">{b.v == null ? '—' : fmt(b.v)}</div><div className="w-full max-w-28 rounded-t-lg" style={{ height: `${b.v == null ? 0 : Math.max(2, (Math.abs(b.v) / max) * 100)}%`, background: b.c, opacity: b.v == null ? 0.2 : 1, printColorAdjust: 'exact' } as any} /></div>)}
      </div>
      <div className="grid grid-cols-3 gap-3 border-t border-line pt-2 text-center text-xs">{bars.map(b => <div key={b.k}><div className="font-semibold">{b.k}</div><div className="opacity-75">{b.b} · tCO₂e</div></div>)}</div>
      {generated == null ? <p className="mt-3 text-sm"><Tbd /> {t('p.noFollowup')}</p> : <p className="mt-3 text-xs opacity-80">{followed} {delta != null && <>· {t('p.tEstimate')} : <strong>{pct(delta, 0)}</strong> {t('p.vsInitial')}. </>}{t('p.caution')} {formula && <span className="block mt-1">{t('p.formula')} : {formula}</span>}</p>}
    </figure>
  );
}

export function Scorecards({ cards, farm }: { cards: any[]; farm?: boolean }) {
  const { t, i18n } = useTranslation(); const en = i18n.language === 'en';
  return (
    <div className="grid md:grid-cols-2 print:grid-cols-2 gap-3">
      {cards.map(c => (
        <section key={c.category} className="card p-4 break-inside-avoid">
          <header className="flex items-center justify-between gap-2"><h3 className="text-base flex items-center gap-2"><CatIcon cat={c.category} size={30} />{c.category}</h3>
            <span className="text-xs flex items-center gap-2" title={t('p.noteHint')}>{t('p.note')} <Dot r={c.initial.note} /> → <Dot r={c.prospectif.note} />{c.prospectif.note == null && <span className="opacity-70">{t('p.noThreshold')}</span>}</span></header>
          <table className="w-full text-sm mt-2"><caption className="sr-only">{c.category}</caption>
            <thead><tr className="text-left text-[11px] opacity-70"><th className="font-normal">{t('s.indicator')}</th><th className="font-normal text-right">{t('s.init')}</th><th className="font-normal text-right">{t('p.target')}</th><th className="font-normal text-right">{t('s.evol')}</th></tr></thead>
            <tbody>{c.items.map((i: any) => { const sh = i.unit === 'part de SAU'; const f = (v: number | null) => (v == null ? '—' : sh ? share(v, 0) : fmt(v, Math.abs(v) < 100 ? 2 : 0)); return (
              <tr key={i.code} className="border-t border-line align-top"><td className="py-1.5 pr-2"><span className="inline-flex items-center gap-1.5 font-medium"><IndIcon code={i.code} size={20} />{en ? i.label_en : i.label_fr}</span> <span className="text-[11px] opacity-60">{sh ? '%' : i.unit}</span>
                {!i.collected ? <div><span className="badge bg-line">{t('s.notCollected')}</span></div> : <>
                  {i.n_applicable != null && <div className="text-[11px] opacity-70">{t('s.coverage', { n: i.n_with_data, t: i.n_applicable })}</div>}
                  {(i.farm_note || (en ? i.why_en : i.why_fr)) && <div className="text-xs opacity-80 mt-0.5">{i.farm_note ?? (en ? i.why_en : i.why_fr)}</div>}
                  {i.levers?.length > 0 && <div className="text-[11px] opacity-70">{t('s.levers')} : {i.levers.join(' · ')}</div>}</>}</td>
                <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{i.collected && <>{f(i.initial)} <Dot r={i.rating_initial} /></>}</td>
                <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{i.collected && <>{f(i.prospectif)} <Dot r={i.rating_prospectif} /></>}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold whitespace-nowrap">{i.collected ? pct(i.evolution) : ''}</td></tr>); })}</tbody></table>
        </section>))}
    </div>
  );
}

export function SheetFooter({ source }: { source: string }) {
  const { t } = useTranslation(); const [qr, setQr] = useState('');
  const url = location.origin + location.pathname;
  useEffect(() => { QRCode.toDataURL(url, { margin: 0, width: 160, color: { dark: '#1e4414', light: '#ffffff' } }).then(setQr).catch(() => {}); }, [url]);
  return <footer className="mt-8 pt-4 border-t border-line flex items-center gap-4 text-xs break-inside-avoid">{qr && <img src={qr} alt={`QR code : ${url}`} className="w-20 h-20" />}<div><div><strong>{t('source')}</strong> : {source} · {t('p.asOf')} {new Date().toLocaleDateString(undefined)}</div><div className="mt-1 opacity-80">{t('p.caution')}</div><div className="mt-1 opacity-70 break-all">{url}</div></div></footer>;
}
export function PdfButton({ path }: { path: string }) {
  const { t, i18n } = useTranslation(); const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const go = async () => { setBusy(true); setErr(''); try { const r = await fetch(`/api/public/pdf?path=${encodeURIComponent(path)}&lang=${i18n.language}`); if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `farmgate_${path.split('/').pop()}.pdf`; a.click(); URL.revokeObjectURL(a.href); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  return <span className="print:hidden"><button className="btn" onClick={go} disabled={busy}>{busy ? t('p.pdfBusy') : `↓ ${t('p.pdf')}`}</button>{err && <span role="alert" className="block text-xs text-red-700 mt-1 max-w-xs">{err}</span>}</span>;
}
