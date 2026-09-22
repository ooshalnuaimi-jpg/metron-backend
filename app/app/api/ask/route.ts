// POST /api/ask { question, context?, mode? } · structured analyst answer over the stored snapshot only
import { requireUser, adminClient } from "@/lib/supabase";
import { snapshotContext, systemPrompt, keysFor, askClaude, parseSections, type Mode } from "@/lib/analyst";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { user, res } = await requireUser(); if (res) return res;
  const body = await req.json().catch(() => ({}));
  const question = String(body.question || "").trim().slice(0, 600); if (!question) return Response.json({ error: "question required" }, { status: 400 });
  const mode: Mode = ["PRO", "CLEAR", "30-SEC"].includes(body.mode) ? body.mode : "PRO";
  const admin = adminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await admin.from("ask_log").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", today);
  if ((count || 0) >= 80) return Response.json({ error: "daily Ask METRON limit reached" }, { status: 429 });
  const { data: snap } = await admin.from("snapshots").select("body").order("fetched_at", { ascending: false }).limit(1).maybeSingle();
  if (!snap) return Response.json({ error: "no snapshot yet" }, { status: 404 });
  const keys = keysFor(question, mode);
  try {
    const { text, model } = await askClaude(systemPrompt(mode, keys), `${snapshotContext(snap.body)}\n\nMODULE CONTEXT: ${JSON.stringify(body.context || {})}\nQUESTION: ${question}`);
    const sections = parseSections(text);
    await admin.from("ask_log").insert({ user_id: user.id, question, context: body.context || {}, answer: { sections }, model });
    return Response.json({ sections, model, fetched: snap.body.fetched });
  } catch (e: any) { return Response.json({ error: String(e?.message || e) }, { status: 502 }); }
}
