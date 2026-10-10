import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany } from "@/lib/db";

/**
 * GET /api/admin/bots — tablero de estados del bot de WhatsApp por comercio.
 * Merge de dos fuentes:
 *  - DB (vendor_wa_bots JOIN vendors): status linked/pairing/unlinked, enabled,
 *    wa_phone, updated_at (última actividad).
 *  - Cerebro (GET /bots, auth WA_BOT_SECRET): conexión viva del relay,
 *    conversaciones activas, mensajes enviados hoy/hora, chats nuevos.
 */
export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const rows = await queryMany<{
    vendor_id: string;
    store_name: string;
    slug: string | null;
    status: string | null;
    enabled: boolean;
    wa_phone: string | null;
    updated_at: string | null;
  }>(
    `SELECT vb.vendor_id, vb.status, vb.enabled, vb.wa_phone, vb.updated_at, v.store_name, v.slug
     FROM vendor_wa_bots vb
     JOIN vendors v ON v.id = vb.vendor_id
     ORDER BY v.store_name ASC`
  ).catch(() => []);

  let llm: Record<string, unknown> | null = null;
  let brainStats: Record<string, unknown> | null = null;
  let limits: Record<string, unknown> | null = null;
  let feed: Array<Record<string, unknown>> = [];
  const liveByVendor = new Map<string, any>();
  const wabotUrl = (process.env.WABOT_URL || "http://wabot:8792").replace(/\/$/, "");
  const authHeaders = { Authorization: `Bearer ${process.env.WA_BOT_SECRET || ""}` };
  try {
    const [r, fr] = await Promise.all([
      fetch(`${wabotUrl}/bots`, { headers: authHeaders, signal: AbortSignal.timeout(8_000) }),
      fetch(`${wabotUrl}/feed?limit=120`, { headers: authHeaders, signal: AbortSignal.timeout(8_000) }).catch(() => null),
    ]);
    if (r.ok) {
      const live = await r.json();
      llm = live.llm ?? null;
      brainStats = live.stats ?? null;
      limits = live.limits ?? null;
      for (const v of live.vendors || []) liveByVendor.set(String(v.vendorId), v);
    }
    if (fr?.ok) {
      const fd = await fr.json().catch(() => null);
      feed = Array.isArray(fd?.events) ? fd.events : [];
    }
  } catch {
    // Sin cerebro conectado: el tablero muestra solo el estado de la DB.
  }

  return NextResponse.json({
    llm,
    stats: brainStats,
    limits,
    feed,
    bots: (rows || []).map((row) => {
      const lv = liveByVendor.get(String(row.vendor_id)) || {};
      return {
        ...row,
        connected: lv.connected === true,
        conversations: lv.conversations ?? 0,
        sentHour: lv.sentHour ?? 0,
        sentDay: lv.sentDay ?? 0,
        newChatsHour: lv.newChatsHour ?? 0,
        inboundHour: lv.inboundHour ?? 0,
        inboundDay: lv.inboundDay ?? 0,
        handoffsHour: lv.handoffsHour ?? 0,
        handoffsDay: lv.handoffsDay ?? 0,
        lastSeen: lv.lastSeen ?? null,
        cooling: lv.cooling === true,
        coolingUntil: lv.coolingUntil ?? null,
      };
    }),
  });
}
