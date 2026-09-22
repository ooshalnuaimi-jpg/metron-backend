// METRON · analyst prompts. The model sees only the stored snapshot; anything missing must be written DATA UNAVAILABLE.

export type Mode = "PRO" | "CLEAR" | "30-SEC";

export function snapshotContext(s: any): string {
  const fmt = (p: any) => `${p.sym} ${p.price == null ? "level N/A" : p.price}${p.unit === "%" ? "%" : ""} ${p.chgPct != null ? p.chgPct + "%" : p.chgBp != null ? p.chgBp + "bp" : ""} ${p.wk != null ? "wk " + p.wk : ""} ${p.status} [${(p.src || []).join(",")}] ${p.note || ""}`;
  const curveKeys = Object.keys(s.curve || {}).filter((k) => /^\d{4}-/.test(k)).sort();
  return [
    `SNAPSHOT fetched ${s.fetched}; market date ${s.marketDate || "n/a"}.`,
    `PULSE: ${(s.pulse || []).map(fmt).join("; ")}`,
    curveKeys.length ? `CURVE ${curveKeys[curveKeys.length - 1]}: ${(s.curve.tenors || []).map((t: string, i: number) => `${t} ${s.curve[curveKeys[curveKeys.length - 1]][i]}`).join(" ")}` : "CURVE: DATA UNAVAILABLE",
    `BANKS: ${(s.banks || []).map((b: any) => `${b.code} ${b.rate || "rate N/A"}: ${b.last || "no statement"}; next ${b.next || "n/a"}; tone ${b.tone}`).join(" | ")}`,
    `WIRE: ${(s.wire || []).map((n: any) => `[${n.src}] ${n.t} ${n.s}: ${n.h}`).join(" | ")}`,
    `CALENDAR: ${(s.calendar || []).map((e: any) => `${e.when} ${e.country} ${e.ev} consensus ${e.cons ?? "UNAVAILABLE"}`).join(" | ")}`,
    `SOURCES: ${Object.entries(s.sources || {}).map(([k, v]: any) => `[${k}] ${v.name} (${v.at})`).join("; ")}`,
  ].join("\n");
}

export function systemPrompt(mode: Mode, keys: string[]): string {
  return `You are the analyst engine of METRON, a private global market intelligence desk for a UAE-based reader (Asia/Dubai). Use ONLY the SNAPSHOT for current facts; if something is not in it write "DATA UNAVAILABLE". Tag claims [FACT] [MARKET DATA] [SOURCE INTERPRETATION] [METRON ANALYSIS] and cite sources as [KEY]. Mechanisms are possibilities, never certainties. No buy or sell advice; never invent probabilities (write PROBABILITY NOT ESTIMATED and use LOWER/MODERATE/HIGHER SUPPORT with evidence). Explain why regions (US, Europe, UK, Japan, China, GCC, UAE) differ where relevant. British English, no em dashes, no Oxford comma. Reading mode ${mode}: ${mode === "30-SEC" ? "four short sections" : mode === "CLEAR" ? "plain professional English with jargon translated inline, numbers and sources kept, never patronising" : "full institutional terminology and depth"}. Respond with JSON only: {"sections":[{"key":"...","text":"..."}]} using exactly these keys in order: ${keys.join(", ")}.`;
}

export function keysFor(question: string, mode: Mode): string[] {
  if (/scenario|bull|bear|upside|downside|what happens if|invalidate/i.test(question)) return ["CURRENT_STATE", "UPSIDE_CASE", "BASE_CASE", "DOWNSIDE_CASE", "CONFIRMATION_INVALIDATION", "SOURCES"];
  if (/long|short|setup|no-trade/i.test(question)) return ["SETUP_CONTEXT", "LONG_SCENARIO", "SHORT_SCENARIO", "WAIT_NO_TRADE", "MAJOR_RISK", "SOURCES"];
  if (mode === "30-SEC") return ["WHAT_HAPPENED", "WHY", "WHAT_IT_AFFECTS", "WATCH", "SOURCES"];
  return ["MARKET_MOVE", "WHAT_HAPPENED", "WHY", "CROSS_ASSET_EFFECTS", "REGIONAL_EFFECTS", "WHAT_TO_WATCH", "SOURCES"];
}

/** Anthropic Messages API (server side). Model id comes from ANTHROPIC_MODEL; check the current models page before changing it. */
export async function askClaude(system: string, user: string, maxTokens = 1400): Promise<{ text: string; model: string }> {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error("ANTHROPIC_API_KEY missing");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const text = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
  return { text, model };
}

export function parseSections(text: string): { key: string; text: string }[] {
  const clean = text.replace(/```json|```/g, "").trim();
  try { const j = JSON.parse(clean); if (Array.isArray(j.sections)) return j.sections; } catch { }
  const m = clean.match(/\{[\s\S]*\}/); if (m) { try { const j = JSON.parse(m[0]); if (Array.isArray(j.sections)) return j.sections; } catch { } }
  return [{ key: "ANSWER", text: clean }];
}
