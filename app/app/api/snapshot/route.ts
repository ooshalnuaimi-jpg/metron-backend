// GET /api/snapshot · latest assembled snapshot for the signed-in member
import { requireUser, adminClient } from "@/lib/supabase";
export const dynamic = "force-dynamic";

export async function GET() {
  const { res } = await requireUser(); if (res) return res;
  const { data, error } = await adminClient().from("snapshots").select("fetched_at, market_date, body, summary").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "no snapshot yet · run /api/refresh" }, { status: 404 });
  return Response.json({ ...data.body, fetched: data.fetched_at, marketDate: data.market_date, summary: data.summary }, { headers: { "cache-control": "private, max-age=60" } });
}
