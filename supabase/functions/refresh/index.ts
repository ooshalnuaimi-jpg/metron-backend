// METRON · refresh (Supabase Edge Function, Deno)
// Called by pg_cron, GitHub Actions or /api/refresh with header `x-metron-secret`.
// Runs every adapter, writes what providers returned (with source, timestamp, status), assembles the snapshot.
import { createClient } from "npm:@supabase/supabase-js@2";
import { Instrument } from "../_shared/types.ts";
import { treasury, fred, twelvedata, rss } from "../_shared/adapters.ts";
import { assembleSnapshot } from "../_shared/assemble.ts";

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
