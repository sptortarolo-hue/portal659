import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import llmModels from "../../../../../../../../services/wa-bot/src/llm-models.json";

/** POST /api/admin/bots/agents/[key]/test-model — ping mínimo al modelo elegido. */
export async function POST(request: Request) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const slug = String(body.model || "").trim();
  const meta = llmModels.models.find((m: any) => m.model === slug);
  if (!meta) return NextResponse.json({ ok: false, error: "Modelo no reconocido" }, { status: 400 });

  const keyByProvider: Record<string, string> = {
    gemini: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    groq: process.env.GROQ_API_KEY || "",
    openrouter: process.env.OPENROUTER_API_KEY || "",
  };
  const baseByProvider: Record<string, string> = {
    gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
    groq: "https://api.groq.com/openai/v1",
    openrouter: "https://openrouter.ai/api/v1",
  };
  const apiKey = keyByProvider[meta.provider] || "";
  if (!apiKey) return NextResponse.json({ ok: false, error: `Sin API key de ${meta.provider}` }, { status: 400 });

  const started = Date.now();
  try {
    const r = await fetch(`${baseByProvider[meta.provider]}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(meta.provider === "openrouter" ? { "HTTP-Referer": "https://www.portal659.com.ar", "X-Title": "Portal 659 wa-bot" } : {}),
      },
      body: JSON.stringify({ model: slug, max_tokens: 48, temperature: 0, messages: [{ role: "user", content: "Respondé exactamente: OK" }] }),
      signal: AbortSignal.timeout(12000),
    });
    const text = await r.text();
    if (!r.ok) return NextResponse.json({ ok: false, status: r.status, error: text.slice(0, 240) }, { status: 200 });
    const data = JSON.parse(text);
    const msg = data?.choices?.[0]?.message || {};
    const reply = String(msg.content ?? msg.reasoning_content ?? "").trim();
    const finish = data?.choices?.[0]?.finish_reason || null;
    return NextResponse.json({
      ok: true,
      status: r.status,
      latencyMs: Date.now() - started,
      reply: reply || null,
      finish,
      note: reply ? null : finish === "length"
        ? "El modelo agotó los tokens de la prueba pensando; en el bot usa max_tokens=600 (configurable en la pestaña)."
        : "El modelo respondió sin contenido; el bot caerá a reglas para ese turno.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "timeout" }, { status: 200 });
  }
}
