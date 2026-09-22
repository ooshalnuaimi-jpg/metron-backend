// Keeps the Supabase session fresh on every request and gates the desk and the personal API.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: { headers: req.headers } });
  const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      get: (name: string) => req.cookies.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => { req.cookies.set({ name, value, ...options }); res = NextResponse.next({ request: { headers: req.headers } }); res.cookies.set({ name, value, ...options }); },
      remove: (name: string, options: CookieOptions) => { req.cookies.set({ name, value: "", ...options }); res = NextResponse.next({ request: { headers: req.headers } }); res.cookies.set({ name, value: "", ...options }); },
    },
  });
  const { data: { user } } = await sb.auth.getUser();
  const p = req.nextUrl.pathname;
  const open = p.startsWith("/login") || p.startsWith("/auth") || p.startsWith("/api/refresh") || p === "/metron.html";
  if (!user && !open) return NextResponse.redirect(new URL("/login", req.url));
  if (p === "/metron.html") return NextResponse.redirect(new URL("/desk", req.url));   // never serve the raw file: /desk checks the session
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
