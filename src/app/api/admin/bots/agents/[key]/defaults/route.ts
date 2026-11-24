import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne, query } from "@/lib/db";
import { AGENT_DEFAULTS } from "../../../../../../../../services/wa-bot/src/agent-defaults.mjs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { key } = await params;
  const a = await queryOne<{ vertical: string | null }>(
    `SELECT v.vertical FROM bot_agents b LEFT JOIN vendors v ON v.id = b.vendor_id WHERE b.key = $1 LIMIT 1`, [key]
  ).catch(() => null);
  const all = AGENT_DEFAULTS as Record<string, any>;
  const d = key === "portal" ? all.portal : (all[a?.vertical || "comercio"] || all.comercio);
  return NextResponse.json(d);
}

/** POST /api/admin/bots/agents/[key]/defaults — restaurar config inicial del agente. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { key } = await params;
  const a = await queryOne<{ key: string; vertical: string | null }>(
    `SELECT b.key, v.vertical FROM bot_agents b
     LEFT JOIN vendors v ON v.id = b.vendor_id WHERE b.key = $1 LIMIT 1`, [key]
  ).catch(() => null);
  if (!a) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });

  const all = AGENT_DEFAULTS as Record<string, any>;
  const d = key === "portal" ? all.portal : (all[a.vertical || "comercio"] || all.comercio);
  await query(
    `UPDATE bot_agents SET greeting = $1, tone = 'humano', brief = $2::jsonb, updated_at = now() WHERE key = $3`,
    [d.greeting, JSON.stringify(d.brief), key]
  );
  return NextResponse.json({ ok: true });
}
