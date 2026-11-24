import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne, queryMany } from "@/lib/db";
import { getBotConfig } from "../../../../../../../../services/wa-bot/src/bot-config.mjs";
import { runLab } from "../../../../../../../../services/wa-bot/src/lab-runner.mjs";

/** POST ... /lab — corre 6 clientes simulados contra el agente (sandbox). */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { key } = await params;
  const body = await request.json().catch(() => ({}));
  const a = await queryOne<{ key: string; vendor_id: string | null; name: string }>(
    `SELECT key, vendor_id, name FROM bot_agents WHERE key = $1 LIMIT 1`, [key]
  ).catch(() => null);
  if (!a) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });

  let vendor: any;
  let config: any;
  if (key === "portal" || !a.vendor_id) {
    vendor = { id: "portal-vendor", store_name: a.name, slug: "portal659-bot", enabled: true, is_portal: true, delivery_options: "ambos" };
    config = await getBotConfig(null, true);
  } else {
    const v = await queryOne<Record<string, unknown>>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [a.vendor_id]).catch(() => null);
    if (!v) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
    vendor = { ...v, id: a.vendor_id };
    config = await getBotConfig(a.vendor_id, false);
  }

  // Catálogo real para el juez (productos + precios del comercio, o del portal).
  const vendorIds = key === "portal"
    ? (await queryMany<{ id: string }>(`SELECT id FROM vendors LIMIT 8`).catch(() => []))
    : [{ id: String(a.vendor_id) }];
  const catalogText = (await queryMany<{ name: string; price: number; store_name: string | null }>(
    `SELECT p.name, p.price, v.store_name FROM products p JOIN vendors v ON v.id = p.vendor_id
     WHERE p.vendor_id = ANY($1::uuid[]) AND p.available = true ORDER BY p.featured_today DESC LIMIT 30`,
    [vendorIds.map((v) => v.id)]
  ).catch(() => []))
    .map((p) => `${p.store_name || ""}: ${p.name} — $${p.price}`).join("\n");

  const out = await runLab({
    vendor,
    agentConfig: config,
    sessionId: String(body.sessionId || "panel").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40),
    judgeEnabled: body.judgeEnabled !== false,
    catalogText,
  });
  return NextResponse.json(out);
}
