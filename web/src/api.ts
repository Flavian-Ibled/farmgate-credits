import i18n from './i18n';
export async function api<T = any>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const r = await fetch('/api' + path, body === undefined ? { credentials: 'same-origin', ...init } : body instanceof FormData ? { method: 'POST', body, credentials: 'same-origin' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', ...init });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j as T;
}
export const fmt = (n: number | null | undefined, d = 0) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(i18n.language === 'en' ? 'en-GB' : 'fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pct = (n: number | null | undefined, d = 1) => (n == null || !Number.isFinite(n) ? '—' : (n > 0 ? '+' : '') + fmt(n * 100, d) + ' %');
export const share = (n: number | null | undefined, d = 0) => (n == null ? '—' : fmt(n * 100, d) + ' %');
export const STATUS_COLOR: Record<string, string> = { 'Labellisé': '#529a38', 'En instruction': '#DFAD0B', 'Sold Out': '#1e4414', 'Diags en cours': '#517DA5', 'Désengagé': '#AF5656' };
export interface Filters { project?: string[]; porteur?: string[]; region?: string[]; departement?: string[]; typology?: string[]; status?: string[]; levers?: string[]; sau_min?: number; sau_max?: number; available_min?: number; ids?: string[]; bassin?: string[]; river?: { name: string; km: number }; near?: { lat: number; lng: number; km: number; label?: string }; polygon?: [number, number][] }
