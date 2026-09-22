// METRON · Supabase clients. The service role key never leaves the server.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Client bound to the signed-in user's cookies (RLS applies). */
export function userClient() {
  const store = cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      get: (name: string) => store.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => { try { store.set({ name, value, ...options }); } catch { } },
      remove: (name: string, options: CookieOptions) => { try { store.set({ name, value: "", ...options }); } catch { } },
    },
  });
}

/** Service-role client for server jobs only (bypasses RLS). */
export function adminClient() {
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

export async function requireUser() {
  const sb = userClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { user: null, sb, res: Response.json({ error: "unauthorised" }, { status: 401 }) };
  return { user, sb, res: null };
}
