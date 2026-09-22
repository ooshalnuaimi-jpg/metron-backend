// METRON · assemble the page-facing snapshot from stored rows. Shape matches the front-end's SNAP object.
import { Calendar, Instrument, Status, freshness } from "./types.ts";

export interface Rows {
  instruments: Instrument[];
  latest: any[];                 // latest_observations view rows
  series: { sym: string; at: string; value: number }[];   // last ~60 days of the tenor series
  curves: { at: string; tenors: string[]; yields: number[]; source_url?: string }[];
  banks: any[]; wire: any[]; calendar: any[]; providers: any[]; previousBody?: any;
}

const TAPE_ORDER = (a: any, b: any) => (a.tape_order ?? 999) - (b.tape_order ?? 999);

export function assembleSnapshot(rows: Rows, fetchedAt: string, sources: Record<string, any>) {
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
