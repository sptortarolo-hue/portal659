import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne, query } from "@/lib/db";

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

  const defaults = JSON.parse(
    readFileSync(path.join(process.cwd(), "services/wa-bot/src/agent-defaults.json"), "utf8")
  );
  const d = key === "portal" ? defaults.portal : (defaults[a.vertical || "comercio"] || defaults.comercio);
  await query(
    `UPDATE bot_agents SET greeting = $1, tone = 'humano', brief = $2::jsonb, updated_at = now() WHERE key = $3`,
    [d.greeting, JSON.stringify(d.brief), key]
  );
  return NextResponse.json({ ok: true });
}
