// METRON · shared types + status engine (Deno / Supabase Edge Functions)

export type Status = "LIVE" | "DELAYED" | "EOD" | "STALE" | "UNAVAILABLE";
export type Calendar = "us" | "eu" | "asia" | "gcc" | "sunthu" | "crypto";

export interface Instrument {
  sym: string; name: string; asset_class: string; region: string; currency: string;
  calendar: Calendar; unit: string; provider: string | null; provider_symbol: string | null; tape_order: number | null; active: boolean;
}

export interface Observation {
  sym: string; at: string;                     // YYYY-MM-DD market date
  value: number | null; chg_pct?: number | null; chg_bp?: number | null; wk?: number | null;
  source: string; source_url?: string; status: Status; note?: string;
}

export interface SeriesPoint { sym: string; at: string; value: number; source: string }
export interface Curve { at: string; tenors: string[]; yields: number[]; source: string; source_url: string }
export interface WireItem { published_at: string; source: string; source_url: string; region?: string; asset_class?: string; importance: "MARKET_MOVING" | "HIGH" | "MEDIUM" | "LOW"; headline: string; context?: string }

export interface AdapterResult {
  provider: string; ok: boolean; error?: string;
  observations: Observation[]; series: SeriesPoint[]; curves: Curve[]; wire: WireItem[];
  sources: Record<string, { name: string; url: string; at: string; status: Status }>;
}

export const emptyResult = (provider: string): AdapterResult => ({ provider, ok: false, observations: [], series: [], curves: [], wire: [], sources: {} });

/** Dubai wall-clock components for `now` (Asia/Dubai = UTC+4, no DST). */
export function dubaiNow(now = new Date()) {
  const d = new Date(now.getTime() + 4 * 3600_000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() + d.getUTCMinutes() / 60, dow: d.getUTCDay(), d };
}

/** Last COMPLETED session date for a market calendar, judged in Dubai time.
 *  us: closes 00:00 GST next day · eu: 20:30 GST · asia: 10:00 GST · gcc/sunthu: 15:00 GST · crypto: continuous (today). */
export function lastSession(cal: Calendar, now = new Date()): string {
  const { hour, d } = dubaiNow(now);
  if (cal === "crypto") return d.toISOString().slice(0, 10);
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const closed = cal === "sunthu" || cal === "gcc" ? hour >= 15 : cal === "asia" ? hour >= 10 : cal === "eu" ? hour >= 20.5 : false;
  if (!closed) dt.setUTCDate(dt.getUTCDate() - 1);
  for (let i = 0; i < 4; i++) {
    const wd = dt.getUTCDay();
    const trading = cal === "sunthu" ? wd !== 5 && wd !== 6 : wd !== 0 && wd !== 6;
    if (trading) break;
    dt.setUTCDate(dt.getUTCDate() - 1);
  }
  return dt.toISOString().slice(0, 10);
}

/** Never call something LIVE unless it is. `base` is what the provider promises (EOD or DELAYED). */
export function freshness(at: string | null, cal: Calendar, base: "EOD" | "DELAYED" = "EOD", now = new Date()): Status {
  if (!at) return "UNAVAILABLE";
  return at >= lastSession(cal, now) ? base : "STALE";
}

export const pct = (a: number, b: number) => b ? Math.round(((a - b) / b) * 10000) / 100 : null;
export const bp = (a: number, b: number) => Math.round((a - b) * 100);

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 12000): Promise<Response> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal, headers: { "user-agent": "METRON/0.4 (private research desk)", ...(init.headers || {}) } }); }
  finally { clearTimeout(t); }
}
