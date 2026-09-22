// METRON · provider adapters. Each returns only what the provider actually returned; nothing is estimated.
import { AdapterResult, Curve, Instrument, Observation, SeriesPoint, WireItem, emptyResult, fetchWithTimeout, freshness, bp, pct } from "./types.ts";

const TREASURY_TENORS: [string, string][] = [["1M", "BC_1MONTH"], ["2M", "BC_2MONTH"], ["3M", "BC_3MONTH"], ["4M", "BC_4MONTH"], ["6M", "BC_6MONTH"], ["1Y", "BC_1YEAR"], ["2Y", "BC_2YEAR"], ["3Y", "BC_3YEAR"], ["5Y", "BC_5YEAR"], ["7Y", "BC_7YEAR"], ["10Y", "BC_10YEAR"], ["20Y", "BC_20YEAR"], ["30Y", "BC_30YEAR"]];

/** US Treasury · daily par yield curve (official XML feed, no key). Returns the curve, 2/5/10/30Y observations and history. */
export async function treasury(instruments: Instrument[], urlTemplate: string): Promise<AdapterResult> {
  const r = emptyResult("treasury");
  try {
    const now = new Date(); const months: string[] = [];
    for (let i = 0; i < 3; i++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); months.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`); }
    const rows: Record<string, Record<string, number>> = {};
    for (const m of months) {
      const url = urlTemplate.replace("{YYYYMM}", m);
      const res = await fetchWithTimeout(url); if (!res.ok) throw new Error(`treasury ${m}: HTTP ${res.status}`);
      const xml = await res.text();
      for (const entry of xml.split("<entry>").slice(1)) {
        const date = /<d:NEW_DATE[^>]*>([^<]+)</.exec(entry)?.[1]?.slice(0, 10); if (!date) continue;
        const vals: Record<string, number> = {};
        for (const [, tag] of TREASURY_TENORS) { const v = new RegExp(`<d:${tag}[^>]*>([^<]*)<`).exec(entry)?.[1]; if (v && v.trim() !== "") vals[tag] = +v; }
        if (Object.keys(vals).length) rows[date] = vals;
      }
    }
    const dates = Object.keys(rows).sort(); if (dates.length < 2) throw new Error("treasury: fewer than two curve dates parsed");
    const url = urlTemplate.replace("{YYYYMM}", months[0]);
    const last = dates[dates.length - 1], prev = dates[dates.length - 2];
    for (const d of dates.slice(-2)) { const tenors = TREASURY_TENORS.filter(([, t]) => rows[d][t] != null); r.curves.push({ at: d, tenors: tenors.map(([n]) => n), yields: tenors.map(([, t]) => rows[d][t]), source: "UST", source_url: url } as Curve); }
    for (const ins of instruments.filter((i) => i.provider === "treasury" && i.provider_symbol)) {
      const tag = ins.provider_symbol!; const v = rows[last]?.[tag], p = rows[prev]?.[tag]; if (v == null) continue;
      const wkDate = dates.filter((d) => d <= last).slice(-6)[0]; const w = rows[wkDate]?.[tag];
      r.observations.push({ sym: ins.sym, at: last, value: v, chg_bp: p != null ? bp(v, p) : null, wk: w != null ? bp(v, w) / 100 : null, source: "UST", source_url: url, status: freshness(last, ins.calendar, "EOD"), note: `${last} close · previous ${prev}` } as Observation);
      for (const d of dates.slice(-60)) if (rows[d][tag] != null) r.series.push({ sym: ins.sym, at: d, value: rows[d][tag], source: "UST" });
    }
    r.sources.UST = { name: "US Treasury · daily par yield curve", url, at: last, status: "EOD" }; r.ok = true;
  } catch (e) { r.error = String(e?.message || e); }
  return r;
}

/** FRED · observations for any instrument whose provider is `fred` (needs FRED_API_KEY). Daily series only; lagged series show STALE honestly. */
export async function fred(instruments: Instrument[], apiKey: string | undefined, base = "https://api.stlouisfed.org/fred/series/observations"): Promise<AdapterResult> {
  const r = emptyResult("fred");
  if (!apiKey) { r.error = "FRED_API_KEY missing"; return r; }
  try {
    for (const ins of instruments.filter((i) => i.provider === "fred" && i.provider_symbol)) {
      const url = `${base}?series_id=${ins.provider_symbol}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=12`;
      const res = await fetchWithTimeout(url); if (!res.ok) { r.error = `${ins.provider_symbol}: HTTP ${res.status}`; continue; }
      const j = await res.json(); const obs = (j.observations || []).filter((o: any) => o.value !== ".").map((o: any) => ({ at: o.date, value: +o.value }));
      if (!obs.length) continue;
      const [a, b] = obs; const w = obs[5];
      const isPct = ins.unit === "%";
      r.observations.push({ sym: ins.sym, at: a.at, value: a.value, chg_pct: !isPct && b ? pct(a.value, b.value) : null, chg_bp: isPct && b ? bp(a.value, b.value) : null, wk: w ? (isPct ? bp(a.value, w.value) / 100 : pct(a.value, w.value)) : null, source: "FRED", source_url: `https://fred.stlouisfed.org/series/${ins.provider_symbol}`, status: freshness(a.at, ins.calendar, "EOD"), note: `FRED ${ins.provider_symbol} · ${a.at}` });
      for (const o of obs.slice().reverse()) r.series.push({ sym: ins.sym, at: o.at, value: o.value, source: "FRED" });
      r.sources.FRED = { name: "FRED, Federal Reserve Bank of St. Louis", url: "https://fred.stlouisfed.org", at: a.at, status: "EOD" };
    }
    r.ok = r.observations.length > 0;
  } catch (e) { r.error = String(e?.message || e); }
  return r;
}

/** Twelve Data · batch quotes (free tier is delayed; unavailable symbols are skipped, never guessed). */
export async function twelvedata(instruments: Instrument[], apiKey: string | undefined, base = "https://api.twelvedata.com"): Promise<AdapterResult> {
  const r = emptyResult("twelvedata");
  if (!apiKey) { r.error = "TWELVEDATA_API_KEY missing"; return r; }
  try {
    const list = instruments.filter((i) => i.provider === "twelvedata" && i.provider_symbol);
    for (let i = 0; i < list.length; i += 8) {                                   // 8 symbols per call keeps the free-tier minute budget
      const batch = list.slice(i, i + 8);
      const res = await fetchWithTimeout(`${base}/quote?symbol=${encodeURIComponent(batch.map((b) => b.provider_symbol).join(","))}&apikey=${apiKey}`);
      if (!res.ok) { r.error = `quote: HTTP ${res.status}`; continue; }
      const j = await res.json(); const byKey = batch.length === 1 ? { [batch[0].provider_symbol!]: j } : j;
      for (const ins of batch) {
        const q = byKey[ins.provider_symbol!]; if (!q || q.status === "error" || q.code) continue;
        const close = +q.close; if (!isFinite(close)) continue;
        const at = String(q.datetime || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
        r.observations.push({ sym: ins.sym, at, value: close, chg_pct: q.percent_change != null ? Math.round(+q.percent_change * 100) / 100 : null, wk: null, source: "TD", source_url: "https://twelvedata.com", status: freshness(at, ins.calendar, q.is_market_open ? "DELAYED" : "EOD"), note: `${q.name || ins.name} · ${q.is_market_open ? "session open, delayed quote" : "last close"}` });
      }
      if (i + 8 < list.length) await new Promise((ok) => setTimeout(ok, 8500));   // respect 8 requests/minute
    }
    if (r.observations.length) r.sources.TD = { name: "Twelve Data (free tier, delayed)", url: "https://twelvedata.com", at: r.observations[0].at, status: "DELAYED" };
    r.ok = r.observations.length > 0;
  } catch (e) { r.error = String(e?.message || e); }
  return r;
}

const IMPORTANCE_RULES: [RegExp, WireItem["importance"]][] = [[/decision|raises|cuts|holds|rate|FOMC|statement|emergency/i, "MARKET_MOVING"], [/minutes|speech|testimony|inflation|CPI|payroll|GDP/i, "HIGH"], [/press release|announce/i, "MEDIUM"]];
const ASSET_RULES: [RegExp, string][] = [[/rate|yield|bond|treasury|gilt|JGB|bund/i, "RATES"], [/dollar|euro|yen|sterling|currency|FX/i, "FX"], [/oil|Brent|gas|gold|commodit/i, "COMMODITIES"], [/equit|stock|shares|index/i, "EQUITIES"]];

/** Official RSS/Atom wires: Fed, ECB, BoE, BoJ, Treasury… A feed that fails is logged, never faked. */
export async function rss(feeds: { id: string; url: string; region?: string }[]): Promise<AdapterResult> {
  const r = emptyResult("rss"); const errors: string[] = [];
  for (const f of feeds) {
    try {
      const res = await fetchWithTimeout(f.url); if (!res.ok) { errors.push(`${f.id}: HTTP ${res.status}`); continue; }
      const xml = await res.text(); const items = xml.includes("<item") ? xml.split(/<item[\s>]/).slice(1) : xml.split(/<entry[\s>]/).slice(1);
      for (const it of items.slice(0, 15)) {
        const tag = (n: string) => { const m = new RegExp(`<${n}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${n}>`).exec(it); return m ? m[1].trim() : ""; };
        const title = tag("title").replace(/<[^>]+>/g, ""); const link = tag("link") || /<link[^>]*href="([^"]+)"/.exec(it)?.[1] || ""; const date = tag("pubDate") || tag("published") || tag("updated") || tag("dc:date");
        if (!title || !link) continue; const when = new Date(date); if (isNaN(when.getTime())) continue;
        const importance = IMPORTANCE_RULES.find(([re]) => re.test(title))?.[1] || "MEDIUM"; const asset = ASSET_RULES.find(([re]) => re.test(title))?.[1] || "MACRO";
        r.wire.push({ published_at: when.toISOString(), source: f.id, source_url: link, region: f.region, asset_class: asset, importance, headline: title.slice(0, 240), context: tag("description").replace(/<[^>]+>/g, "").slice(0, 280) || undefined });
      }
      r.sources[f.id] = { name: `${f.id} official feed`, url: f.url, at: new Date().toISOString().slice(0, 10), status: "DELAYED" };
    } catch (e) { errors.push(`${f.id}: ${String(e?.message || e)}`); }
  }
  r.ok = r.wire.length > 0; if (errors.length) r.error = errors.join("; ");
  return r;
}
