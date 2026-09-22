// GET /api/user · everything personal in one call; PUT /api/user · merge updates from the page
import { requireUser } from "@/lib/supabase";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, sb, res } = await requireUser(); if (res) return res;
  const [profile, watch, holdings, positions, journal, learning] = await Promise.all([
    sb.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    sb.from("watchlists").select("sym").eq("user_id", user.id),
    sb.from("holdings").select("id, sym, weight").eq("user_id", user.id),
    sb.from("paper_positions").select("*").eq("user_id", user.id).is("closed_at", null),
    sb.from("journal_entries").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
    sb.from("learning_progress").select("*").eq("user_id", user.id),
  ]);
  return Response.json({ profile: profile.data, watch: (watch.data || []).map((w) => w.sym), holdings: holdings.data || [], positions: positions.data || [], journal: journal.data || [], learning: Object.fromEntries((learning.data || []).map((l) => [l.lesson_id, l])) });
}

export async function PUT(req: Request) {
  const { user, sb, res } = await requireUser(); if (res) return res;
  const b = await req.json().catch(() => ({}));
  const out: Record<string, any> = {};
  if (b.profile) { const allowed = (({ name, reading_mode, regions, brief_time, notifications, timezone }) => ({ name, reading_mode, regions, brief_time, notifications, timezone }))(b.profile); out.profile = (await sb.from("profiles").update(Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined))).eq("id", user.id).select().maybeSingle()).data; }
  if (Array.isArray(b.watch)) { await sb.from("watchlists").delete().eq("user_id", user.id); if (b.watch.length) await sb.from("watchlists").insert(b.watch.map((sym: string) => ({ user_id: user.id, sym: String(sym).slice(0, 20) }))); out.watch = b.watch; }
  if (Array.isArray(b.holdings)) { await sb.from("holdings").delete().eq("user_id", user.id); if (b.holdings.length) await sb.from("holdings").insert(b.holdings.map((h: any) => ({ user_id: user.id, sym: String(h.sym).slice(0, 20), weight: +h.w || +h.weight || 0 }))); out.holdings = b.holdings; }
  if (Array.isArray(b.positions)) { await sb.from("paper_positions").delete().eq("user_id", user.id).is("closed_at", null); if (b.positions.length) await sb.from("paper_positions").insert(b.positions.map((p: any) => ({ user_id: user.id, sym: p.sym, side: p.side, size: p.size, entry: p.e, stop: p.s, target: p.t, rr: +p.rr || null, thesis: p.thesis, catalyst: p.cat, invalidation: p.inv }))); out.positions = b.positions; }
  if (Array.isArray(b.journal) && b.journal.length) { await sb.from("journal_entries").insert(b.journal.map((j: any) => ({ user_id: user.id, sym: j.sym, side: j.side, thesis: j.thesis, catalyst: j.cat, invalidation: j.inv, result: j.result, lesson_id: j.lessonId, notes: j.lesson }))); out.journal = "appended"; }
  if (b.learning && typeof b.learning === "object") { const rows = Object.entries(b.learning).map(([lesson_id, s]: any) => ({ user_id: user.id, lesson_id, stage: s.mastered ? "MASTERED" : s.recalled ? "UNDERSTOOD" : s.done ? "LEARNING" : "INTRODUCED", answer: s.answer ?? null, done_at: s.doneAt || null, recalls: s.recalls || 0, next_due: s.nextDue || null, mastered: !!s.mastered, updated_at: new Date().toISOString() })); if (rows.length) await sb.from("learning_progress").upsert(rows, { onConflict: "user_id,lesson_id" }); out.learning = rows.length; }
  return Response.json({ ok: true, ...out });
}
