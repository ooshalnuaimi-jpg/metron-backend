// METRON · refresh, single-file build for the Supabase dashboard editor (no CLI needed).
// Same code as refresh/index.ts + _shared/*, concatenated. Paste the whole file into Edge Functions → New function → "refresh".
import { createClient } from "npm:@supabase/supabase-js@2";

// ===== types + status engine =====
// METRON · shared types + status engine (Deno / Supabase Edge Functions)

type Status = "LIVE" | "DELAYED" | "EOD" | "STALE" | "UNAVAILABLE";
type Calendar = "us" | "eu" | "asia" | "gcc" | "sunthu" | "crypto";

interface Instrument {
  sym: string; name: string; asset_class: string; region: string; currency: string;
  calendar: Calendar; unit: string; provider: string | null; provider_symbol: string | null; tape_order: number | null; active: boolean;
}

interface Observation {
  sym: string; at: string;                     // YYYY-MM-DD market date
  value: number | null; chg_pct?: number | null; chg_bp?: number | null; wk?: number | null;
  source: string; source_url?: string; status: Status; note?: string;
}

interface SeriesPoint { sym: string; at: string; value: number; source: string }
interface Curve { at: string; tenors: string[]; yields: number[]; source: string; source_url: string }
interface WireItem { published_at: string; source: string; source_url: string; region?: string; asset_class?: string; importance: "MARKET_MOVING" | "HIGH" | "MEDIUM" | "LOW"; headline: string; context?: string }

interface AdapterResult {
  provider: string; ok: boolean; error?: string;
  observations: Observation[]; series: SeriesPoint[]; curves: Curve[]; wire: WireItem[];
  sources: Record<string, { name: string; url: string; at: string; status: Status }>;
}

const emptyResult = (provider: string): AdapterResult => ({ provider, ok: false, observations: [], series: [], curves: [], wire: [], sources: {} });

/** Dubai wall-clock components for `now` (Asia/Dubai = UTC+4, no DST). */
function dubaiNow(now = new Date()) {
  const d = new Date(now.getTime() + 4 * 3600_000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() + d.getUTCMinutes() / 60, dow: d.getUTCDay(), d };
}

/** Last COMPLETED session date for a market calendar, judged in Dubai time.
 *  us: closes 00:00 GST next day · eu: 20:30 GST · asia: 10:00 GST · gcc/sunthu: 15:00 GST · crypto: continuous (today). */
function lastSession(cal: Calendar, now = new Date()): string {
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
function freshness(at: string | null, cal: Calendar, base: "EOD" | "DELAYED" = "EOD", now = new Date()): Status {
  if (!at) return "UNAVAILABLE";
  return at >= lastSession(cal, now) ? base : "STALE";
}

const pct = (a: number, b: number) => b ? Math.round(((a - b) / b) * 10000) / 100 : null;
const bp = (a: number, b: number) => Math.round((a - b) * 100);

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 12000): Promise<Response> {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal, headers: { "user-agent": "METRON/0.4 (private research desk)", ...(init.headers || {}) } }); }
  finally { clearTimeout(t); }
}

// ===== adapters =====
// METRON · provider adapters. Each returns only what the provider actually returned; nothing is estimated.

const TREASURY_TENORS: [string, string][] = [["1M", "BC_1MONTH"], ["2M", "BC_2MONTH"], ["3M", "BC_3MONTH"], ["4M", "BC_4MONTH"], ["6M", "BC_6MONTH"], ["1Y", "BC_1YEAR"], ["2Y", "BC_2YEAR"], ["3Y", "BC_3YEAR"], ["5Y", "BC_5YEAR"], ["7Y", "BC_7YEAR"], ["10Y", "BC_10YEAR"], ["20Y", "BC_20YEAR"], ["30Y", "BC_30YEAR"]];

/** US Treasury · daily par yield curve (official XML feed, no key). Returns the curve, 2/5/10/30Y observations and history. */
async function treasury(instruments: Instrument[], urlTemplate: string): Promise<AdapterResult> {
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
async function fred(instruments: Instrument[], apiKey: string | undefined, base = "https://api.stlouisfed.org/fred/series/observations"): Promise<AdapterResult> {
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
async function twelvedata(instruments: Instrument[], apiKey: string | undefined, base = "https://api.twelvedata.com"): Promise<AdapterResult> {
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
async function rss(feeds: { id: string; url: string; region?: string }[]): Promise<AdapterResult> {
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

// ===== assembler =====
// METRON · assemble the page-facing snapshot from stored rows. Shape matches the front-end's SNAP object.

interface Rows {
  instruments: Instrument[];
  latest: any[];                 // latest_observations view rows
  series: { sym: string; at: string; value: number }[];   // last ~60 days of the tenor series
  curves: { at: string; tenors: string[]; yields: number[]; source_url?: string }[];
  banks: any[]; wire: any[]; calendar: any[]; providers: any[]; previousBody?: any;
}

const TAPE_ORDER = (a: any, b: any) => (a.tape_order ?? 999) - (b.tape_order ?? 999);

function assembleSnapshot(rows: Rows, fetchedAt: string, sources: Record<string, any>) {
  const now = new Date();
  const bySym = new Map(rows.latest.map((o) => [o.sym, o]));
  const pulse = rows.instruments.filter((i) => i.active).sort(TAPE_ORDER).map((i) => {
    const o = bySym.get(i.sym);
    if (!o) return { sym: i.sym, name: i.name, status: "UNAVAILABLE" as Status, note: i.provider === "none" || i.provider === "exchange" ? "provider not connected" : "no observation returned", src: [] };
    const status = o.status === "DELAYED" || o.status === "EOD" ? freshness(o.at, i.calendar as Calendar, o.status, now) : o.status;
    return { sym: i.sym, name: i.name, price: o.value == null ? null : +o.value, unit: i.unit || "", chgPct: o.chg_pct == null ? null : +o.chg_pct, chgBp: o.chg_bp == null ? null : +o.chg_bp, wk: o.wk == null ? null : +o.wk, at: o.at, status, note: o.note || "", src: [o.source] };
  });

  // curve: latest two dates keyed by date, same as the prototype
  const curve: Record<string, any> = {};
  const cs = rows.curves.slice().sort((a, b) => a.at.localeCompare(b.at)).slice(-2);
  if (cs.length) { curve.tenors = cs[cs.length - 1].tenors; for (const c of cs) curve[c.at] = c.yields; }

  // hist: [date, 2Y, 5Y, 10Y, 30Y] for the last 41 sessions where all four exist
  const byDate: Record<string, Record<string, number>> = {};
  for (const s of rows.series) if (["US2Y", "US5Y", "US10Y", "US30Y"].includes(s.sym)) (byDate[s.at] = byDate[s.at] || {})[s.sym] = +s.value;
  const hist = Object.keys(byDate).sort().filter((d) => ["US2Y", "US5Y", "US10Y", "US30Y"].every((k) => byDate[d][k] != null)).slice(-41).map((d) => [d, byDate[d].US2Y, byDate[d].US5Y, byDate[d].US10Y, byDate[d].US30Y]);

  const banks = rows.banks.map((b) => ({ code: b.code, name: b.name, rate: b.rate, last: b.last_move, next: b.next_meeting, tone: b.tone || "UNAVAILABLE", evidence: b.evidence || "No statement ingested yet", src: b.source ? [b.source] : [] }));
  const impRank: Record<string, number> = { MARKET_MOVING: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const wire = rows.wire.slice().sort((a, b) => (impRank[a.importance] - impRank[b.importance]) || b.published_at.localeCompare(a.published_at)).slice(0, 14).map((w) => ({ t: w.published_at.slice(0, 16).replace("T", " "), s: w.source, cat: w.asset_class || "MACRO", imp: w.importance, h: w.headline, src: w.source, url: w.source_url, region: w.region }));
  const calendar = rows.calendar.map((e) => ({ when: e.when_text || (e.when_at || "").slice(0, 10), gst: e.when_at ? new Date(new Date(e.when_at).getTime() + 4 * 3600_000).toISOString().slice(11, 16) + " GST" : "TBC", country: e.region, ev: e.event, act: e.actual, cons: e.consensus, prev: e.previous, imp: e.importance, assets: e.assets || [], src: e.source }));

  const marketDate = pulse.filter((p) => p.at && p.status !== "UNAVAILABLE").map((p) => p.at).sort().slice(-1)[0] || null;
  const drivers = rows.previousBody?.drivers || [];   // narrative drivers are produced by the brief generator, never by the ingestion job
  return { fetched: fetchedAt, marketDate, sources, pulse, curve, hist, banks, wire, calendar, drivers, providers: rows.providers.map((p) => ({ id: p.id, name: p.name, domain: p.domain, status: p.status, last_ok: p.last_ok, last_error: p.last_error })) };
}

// ===== handler =====
// METRON · refresh (Supabase Edge Function, Deno)
// Called by pg_cron, GitHub Actions or /api/refresh with header `x-metron-secret`.
// Runs every adapter, writes what providers returned (with source, timestamp, status), assembles the snapshot.


const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("METRON_REFRESH_SECRET") || "";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SECRET || req.headers.get("x-metron-secret") !== SECRET) return json({ error: "unauthorised" }, 401);
  const started = Date.now();
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: instruments, error: ie } = await db.from("instruments").select("*").eq("active", true);
  if (ie) return json({ error: ie.message }, 500);
  const { data: provRows } = await db.from("providers").select("*");
  const prov = Object.fromEntries((provRows || []).map((p: any) => [p.id, p]));

  const results = await Promise.all([
    treasury(instruments as Instrument[], prov.treasury?.config?.url || "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month={YYYYMM}"),
    fred(instruments as Instrument[], Deno.env.get("FRED_API_KEY")),
    twelvedata(instruments as Instrument[], Deno.env.get("TWELVEDATA_API_KEY")),
    rss(prov.rss?.config?.feeds || []),
  ]);

  const summary: Record<string, any> = { started: new Date(started).toISOString(), providers: {} };
  const sources: Record<string, any> = {};
  for (const r of results) {
    summary.providers[r.provider] = { ok: r.ok, error: r.error || null, observations: r.observations.length, series: r.series.length, curves: r.curves.length, wire: r.wire.length };
    Object.assign(sources, r.sources);
    await db.from("providers").update({ status: r.ok ? "CONNECTED" : r.error?.includes("missing") ? "KEY MISSING" : "ERROR", last_ok: r.ok ? new Date().toISOString() : undefined, last_error: r.error || null, updated_at: new Date().toISOString() }).eq("id", r.provider);
    if (r.observations.length) await db.from("observations").upsert(r.observations.map((o) => ({ ...o, fetched_at: new Date().toISOString() })), { onConflict: "sym,at,source" });
    if (r.series.length) await db.from("series_daily").upsert(r.series, { onConflict: "sym,at" });
    if (r.curves.length) await db.from("curves").upsert(r.curves, { onConflict: "at,source" });
    if (r.wire.length) await db.from("wire_items").upsert(r.wire, { onConflict: "source_url", ignoreDuplicates: true });
  }

  // Assemble the page-facing snapshot from what is now stored (not from this run alone, so a failed provider keeps its last good rows, marked STALE by the status engine)
  const since = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const [{ data: latest }, { data: series }, { data: curves }, { data: banks }, { data: wire }, { data: calendar }, { data: providers }, { data: prevSnap }] = await Promise.all([
    db.from("latest_observations").select("*"),
    db.from("series_daily").select("sym,at,value").gte("at", since),
    db.from("curves").select("at,tenors,yields,source_url").order("at", { ascending: false }).limit(2),
    db.from("central_banks").select("*"),
    db.from("wire_items").select("*").order("published_at", { ascending: false }).limit(60),
    db.from("calendar_events").select("*").gte("when_at", new Date(Date.now() - 86400_000).toISOString()).order("when_at").limit(30),
    db.from("providers").select("*"),
    db.from("snapshots").select("body").order("fetched_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const fetchedAt = new Date().toISOString();
  const body = assembleSnapshot({ instruments: instruments as Instrument[], latest: latest || [], series: series || [], curves: curves || [], banks: banks || [], wire: wire || [], calendar: calendar || [], providers: providers || [], previousBody: prevSnap?.body }, fetchedAt, { ...(prevSnap?.body?.sources || {}), ...sources });
  summary.durationMs = Date.now() - started;
  const { error: se } = await db.from("snapshots").insert({ fetched_at: fetchedAt, market_date: body.marketDate, body, summary });
  if (se) return json({ error: se.message, summary }, 500);
  return json({ ok: true, fetched: fetchedAt, marketDate: body.marketDate, summary });
});

function json(b: unknown, status = 200) { return new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } }); }