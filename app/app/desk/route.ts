// GET /desk · serves the METRON interface to signed-in members only
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireUser } from "@/lib/supabase";
export const dynamic = "force-dynamic";

export async function GET() {
  const { res } = await requireUser(); if (res) return Response.redirect(new URL("/login", process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"), 302);
  const html = readFileSync(join(process.cwd(), "public", "metron.html"), "utf8");
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
