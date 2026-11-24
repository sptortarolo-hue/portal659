import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne, queryMany, query } from "@/lib/db";
import { SYSTEM_PROMPT } from "../../../../../../../services/wa-bot/src/system-prompt.mjs";

/** System prompt real del motor — fuente única compartida con el cerebro. */
function basePrompt(): string { return SYSTEM_PROMPT; }

function promptView(a: Record<string, unknown>, faqs: { question: string; answer: string }[]) {
  const b = (a.brief && typeof a.brief === "object" ? a.brief : {}) as Record<string, unknown>;
  const lines: string[] = [];
  const add = (title: string, text: unknown) => {
    const t = String(text || "").trim();
    if (t) lines.push(`### ${title}\n${t}`);
  };
  add("Tu trabajo", b.instructions);
  add("El negocio", [b.business, b.products, b.audience, b.policies].filter(Boolean).join("\n"));
  const rules = [
    ...(Array.isArray(b.always) ? b.always.map((x) => `- SIEMPRE: ${x}`) : []),
    ...(Array.isArray(b.never) ? b.never.map((x) => `- NUNCA: ${x}`) : []),
  ];
  if (rules.length) lines.push(`### Reglas\n${rules.join("\n")}`);
  if (faqs.length) lines.push(`### Conocimiento\n${faqs.map((f) => `P: ${f.question}\nR: ${f.answer}`).join("\n\n")}`);
  return lines.length ? `INFORMACIÓN DE ESTE AGENTE (${String(a.name || "comercio")}):\n${lines.join("\n\n")}` : "";
}

/** GET /api/admin/bots/agents/[key] — detalle del agente (admin only). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { key } = await params;
  const a = await queryOne<Record<string, unknown>>(
    `SELECT b.key, b.vendor_id, b.name, b.mode, b.enabled, b.tone, b.greeting,
            b.handoff_phone, b.brief, b.model, v.store_name, v.slug,
            vb.status AS link_status, vb.wa_phone
     FROM bot_agents b LEFT JOIN vendors v ON v.id = b.vendor_id
     LEFT JOIN vendor_wa_bots vb ON vb.vendor_id = b.vendor_id
     WHERE b.key = $1 LIMIT 1`, [key]
  ).catch(() => null);
  if (!a) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  const faqs = await queryMany<{ question: string; answer: string }>(
    `SELECT question, answer FROM bot_agent_faqs WHERE agent_key = $1 AND active = true ORDER BY created_at ASC LIMIT 40`, [key]
  ).catch(() => []);
  const agentBlock = promptView(a, faqs);
  return NextResponse.json({
    agent: a,
    basePrompt: basePrompt(),
    prompt: basePrompt() + agentBlock,
    agentBlock,
    promptChars: basePrompt().length + agentBlock.length,
  });
}

/** PATCH /api/admin/bots/agents/[key] — editar un agente (admin only). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const { key } = await params;
  const body = await request.json().catch(() => ({}));

  const current = await queryOne<{ key: string }>(
    `SELECT key FROM bot_agents WHERE key = $1 LIMIT 1`, [key]
  ).catch(() => null);
  if (!current) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });

  const fields: string[] = [];
  const values: unknown[] = [];
  const put = (column: string, value: unknown) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };

  if (typeof body.name === "string" && body.name.trim()) put("name", body.name.trim().slice(0, 80));
  if (body.mode === "concierge" || body.mode === "orders") put("mode", body.mode);
  if (typeof body.enabled === "boolean") put("enabled", body.enabled);
  if (body.tone === "clasico" || body.tone === "humano") put("tone", body.tone);
  if (typeof body.greeting === "string") put("greeting", body.greeting.slice(0, 500) || null);
  if (typeof body.handoff_phone === "string") put("handoff_phone", body.handoff_phone.slice(0, 40) || null);
  if (body.brief && typeof body.brief === "object") put("brief", JSON.stringify(body.brief));
  if (typeof body.model === "string" && body.model.trim()) put("model", body.model.trim().slice(0, 120));
  if (body.model === null) put("model", null);

  if (fields.length === 0) {
    return NextResponse.json({ error: "Sin campos válidos" }, { status: 400 });
  }
  values.push(key);
  await query(
    `UPDATE bot_agents SET ${fields.join(", ")}, updated_at = now() WHERE key = $${values.length}`,
    values
  );
  return NextResponse.json({ ok: true, key });
}
