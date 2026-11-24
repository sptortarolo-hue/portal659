import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne, query } from "@/lib/db";

type Ctx = { params: Promise<{ key: string; id: string }> };

/** PATCH /api/admin/bots/agents/[key]/faqs/[id] — activar/desactivar o editar. */
export async function PATCH(request: Request, { params }: Ctx) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { key, id } = await params;
  const body = await request.json().catch(() => ({}));
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM bot_agent_faqs WHERE id = $1 AND agent_key = $2 LIMIT 1`, [id, key]
  ).catch(() => null);
  if (!row) return NextResponse.json({ error: "FAQ no encontrada" }, { status: 404 });
  if (typeof body.active === "boolean") await query(`UPDATE bot_agent_faqs SET active = $1 WHERE id = $2`, [body.active, id]);
  if (typeof body.question === "string") await query(`UPDATE bot_agent_faqs SET question = $1 WHERE id = $2`, [body.question.slice(0, 300), id]);
  if (typeof body.answer === "string") await query(`UPDATE bot_agent_faqs SET answer = $1 WHERE id = $2`, [body.answer.slice(0, 1200), id]);
  return NextResponse.json({ ok: true });
}

/** DELETE — borrar FAQ. */
export async function DELETE(request: Request, { params }: Ctx) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { key, id } = await params;
  await query(`DELETE FROM bot_agent_faqs WHERE id = $1 AND agent_key = $2`, [id, key]);
  return NextResponse.json({ ok: true });
}
