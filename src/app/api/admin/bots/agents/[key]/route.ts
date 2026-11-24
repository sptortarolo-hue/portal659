import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne, query } from "@/lib/db";

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
