import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query } from "@/lib/db";

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/admin/bots/agents/[key]/faqs — knowledge base del agente. */
export async function GET(request: Request, { params }: Ctx) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { key } = await params;
  const rows = await queryMany<{ id: string; question: string; answer: string; active: boolean }>(
    `SELECT id, question, answer, active FROM bot_agent_faqs WHERE agent_key = $1 ORDER BY created_at ASC`, [key]
  ).catch(() => []);
  return NextResponse.json({ faqs: rows });
}

/** POST — alta de pregunta/respuesta. */
export async function POST(request: Request, { params }: Ctx) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { key } = await params;
  const body = await request.json().catch(() => ({}));
  const question = String(body.question || "").trim().slice(0, 300);
  const answer = String(body.answer || "").trim().slice(0, 1200);
  if (!question || !answer) return NextResponse.json({ error: "Pregunta y respuesta requeridas" }, { status: 400 });
  const exists = await queryOne<{ key: string }>(`SELECT key FROM bot_agents WHERE key = $1 LIMIT 1`, [key]).catch(() => null);
  if (!exists) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  await query(
    `INSERT INTO bot_agent_faqs (agent_key, question, answer) VALUES ($1, $2, $3)`,
    [key, question, answer]
  );
  return NextResponse.json({ ok: true });
}
