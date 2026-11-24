import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";

/**
 * GET /api/vendor/bot/status — SOLO LECTURA para el dueño del comercio.
 * No expone escritura: el comercio usa su bot, no lo configura (Fase 1).
 */
export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const cfg = await queryOne<{
    key: string; name: string; mode: string; enabled: boolean;
    tone: string; greeting: string | null; handoff_phone: string | null;
  }>(
    `SELECT key, name, mode, enabled, tone, greeting, handoff_phone
     FROM bot_agents WHERE vendor_id = $1 LIMIT 1`, [vendor.id]
  ).catch(() => null);

  const link = await queryOne<{ status: string | null; wa_phone: string | null }>(
    `SELECT status, wa_phone FROM vendor_wa_bots WHERE vendor_id = $1 LIMIT 1`, [vendor.id]
  ).catch(() => null);

  // Estado vivo del cerebro (opcional)
  let live: any = null;
  const wabotUrl = (process.env.WABOT_URL || "http://portal659-wabot:8792").replace(/\/$/, "");
  try {
    const r = await fetch(`${wabotUrl}/bots`, {
      headers: { Authorization: `Bearer ${process.env.WA_BOT_SECRET || ""}` },
      signal: AbortSignal.timeout(3500),
    });
    if (r.ok) {
      const data = await r.json();
      live = (data?.vendors || []).find((v: any) => String(v.vendorId) === String(vendor.id)) || null;
    }
  } catch { /* cerebro no responde: mostramos la config guardada */ }

  return NextResponse.json({
    name: cfg?.name || null,
    mode: cfg?.mode || "concierge",
    enabled: cfg?.enabled === true,
    tone: cfg?.tone || "humano",
    greeting: cfg?.greeting || null,
    handoffPhone: cfg?.handoff_phone || null,
    linked: link?.status === "linked",
    waPhone: link?.wa_phone || null,
    connected: live?.connected === true,
    lastSeen: live?.lastSeen ?? null,
    messagesDay: live?.inboundDay ?? 0,
    handoffsDay: live?.handoffsDay ?? 0,
    configured: !!cfg,
  });
}
