// Handles invite and magic-link emails whose template points at /auth/confirm?token_hash=…&type=…
// (Supabase → Authentication → Email Templates: use {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite|magiclink|recovery)
import { userClient } from "@/lib/supabase";
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token_hash = url.searchParams.get("token_hash"); const type = url.searchParams.get("type") as any;
  if (token_hash && type) { const { error } = await userClient().auth.verifyOtp({ token_hash, type }); if (error) return Response.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin), 302); }
  return Response.redirect(new URL("/desk", url.origin), 302);
}
