import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne, queryMany } from "@/lib/db";
import { getBotConfig } from "../../../../../../../../services/wa-bot/src/bot-config.mjs";
import { runPlaygroundTurn, runLab } from "../../../../../../../../services/wa-bot/src/lab-runner.mjs";

async function resolveAgent(key: string) {
  const a = await queryOne<{ key: string; vendor_id: string | null; name: string }>(
    `SELECT key, vendor_id, name FROM bot_agents WHERE key = $1 LIMIT 1`, [key]
  ).catch(() => null);
  if (!a) return null;
  if (key === "portal" || !a.vendor_id) {
    return {
      vendor: { id: "portal-vendor", store_name: a.name, slug: "portal659-bot", enabled: true, is_portal: true, delivery_options: "ambos" },
      config: await getBotConfig(null, true),
    };
  }
  const v = await queryOne<Record<string, unknown>>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [a.vendor_id]).catch(() => null);
  if (!v) return null;
  return { vendor: { ...v, id: a.vendor_id, store_name: String(v.store_name || a.name) }, config: await getBotConfig(a.vendor_id, false) };
}

/** POST ... /playground { sessionId, message } — una respuesta en sandbox. */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { key } = await params;
  const body = await request.json().catch(() => ({}));
  const agent = await resolveAgent(key);
  if (!agent) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  const sessionId = String(body.sessionId || "default").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
  const message = String(body.message || "").slice(0, 500);
  if (!message) return NextResponse.json({ error: "Mensaje requerido" }, { status: 400 });
  const out = await runPlaygroundTurn({ vendor: agent.vendor as any, agentConfig: agent.config, sessionId, message });
  return NextResponse.json(out);
}

/** DELETE ... /playground?sessionId=X — limpiar sesión de prueba. */
export async function DELETE(request: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { clearState } = await import("../../../../../../../../services/wa-bot/src/state.mjs");
  const { key } = await params;
  const sessionId = new URL(request.url).searchParams.get("sessionId") || "default";
  const agent = await resolveAgent(key);
  if (!agent) return NextResponse.json({ ok: false }, { status: 404 });
  await clearState(agent.vendor.id, `playground_${sessionId}`);
  return NextResponse.json({ ok: true });
}
