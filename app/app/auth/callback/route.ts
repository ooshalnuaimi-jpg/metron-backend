// Magic-link and invite callbacks land here, exchange the code for a session, then enter the desk.
import { userClient } from "@/lib/supabase";
export async function GET(req: Request) {
  const url = new URL(req.url); const code = url.searchParams.get("code");
  if (code) await userClient().auth.exchangeCodeForSession(code);
  return Response.redirect(new URL("/desk", url.origin), 302);
}
