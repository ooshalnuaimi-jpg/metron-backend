// POST /api/refresh (x-metron-secret) or GET from Vercel Cron (Authorization: Bearer CRON_SECRET)
// Forwards to the Supabase Edge Function so the provider logic lives in one place.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run() {
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/refresh`;
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-metron-secret": process.env.METRON_REFRESH_SECRET || "", authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` }, body: "{}" });
  return Response.json(await r.json().catch(() => ({ error: `edge function HTTP ${r.status}` })), { status: r.status });
}
export async function POST(req: Request) {
  if (req.headers.get("x-metron-secret") !== process.env.METRON_REFRESH_SECRET) return Response.json({ error: "unauthorised" }, { status: 401 });
  return run();
}
export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ error: "unauthorised" }, { status: 401 });
  return run();
}
