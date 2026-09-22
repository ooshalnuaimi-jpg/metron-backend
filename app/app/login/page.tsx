"use client";
// METRON · private login. Sign-ups are disabled in Supabase; the owner invites members from the dashboard.
import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function Login() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false); if (error) return setErr(error.message);
    window.location.href = "/desk";
  }
  async function magic() { setErr(""); const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } }); setErr(error ? error.message : "Check your inbox for the sign-in link."); }
  const inp: React.CSSProperties = { width: "100%", background: "#0A0A0A", border: "1px solid #2A2C30", borderRadius: 3, padding: "10px 11px", color: "#F4F4F2", fontSize: 13, marginTop: 5 };
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#000", padding: 24 }}>
      <form onSubmit={go} style={{ width: 360, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 26 }}>
          <svg width="36" height="36" viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="11" width="4" height="8" fill="#FF2D00" /><rect x="8" y="6" width="4" height="13" fill="#FF2D00" /><rect x="15" y="1" width="4" height="18" fill="#FF2D00" /></svg>
          <div><div style={{ fontWeight: 600, fontSize: 22, letterSpacing: ".34em" }}>METRON</div><div style={{ fontSize: 10, letterSpacing: ".24em", color: "#5C626A" }}>GLOBAL MARKET INTELLIGENCE</div></div>
        </div>
        <label style={{ fontSize: 10, letterSpacing: ".14em", color: "#5C626A" }}>EMAIL<input style={inp} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label style={{ fontSize: 10, letterSpacing: ".14em", color: "#5C626A" }}>PASSWORD<input style={inp} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <div style={{ fontSize: 11, color: "#D9534B", minHeight: 14 }}>{err}</div>
        <button disabled={busy} style={{ background: "#FF2D00", color: "#fff", border: 0, borderRadius: 3, padding: 11, fontSize: 11.5, letterSpacing: ".14em", cursor: "pointer" }}>{busy ? "SIGNING IN" : "SECURE LOGIN"}</button>
        <button type="button" onClick={magic} style={{ background: "none", border: 0, color: "#8E949C", fontSize: 11, cursor: "pointer", textAlign: "right" }}>Send me a sign-in link instead</button>
        <div style={{ fontFamily: "monospace", fontSize: 9, letterSpacing: ".12em", color: "#3D4249", marginTop: 36, textAlign: "center", lineHeight: 1.7 }}>PRIVATE ACCESS · INVITE ONLY</div>
      </form>
    </main>
  );
}
