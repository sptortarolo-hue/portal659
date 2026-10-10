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
  const liveByVendor = new Map<string, any>();
  const wabotUrl = (process.env.WABOT_URL || "http://wabot:8792").replace(/\/$/, "");
  try {
    const r = await fetch(`${wabotUrl}/bots`, {
      headers: { Authorization: `Bearer ${process.env.WA_BOT_SECRET || ""}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (r.ok) {
      const live = await r.json();
      llm = live.llm ?? null;
      for (const v of live.vendors || []) liveByVendor.set(String(v.vendorId), v);
    }
  } catch {
    // Sin cerebro conectado: el tablero muestra solo el estado de la DB.
  }

  return NextResponse.json({
    llm,
    bots: (rows || []).map((row) => {
      const lv = liveByVendor.get(String(row.vendor_id));
      return {
        ...row,
        connected: lv?.connected === true,
        conversations: lv?.conversations ?? 0,
        sentHour: lv?.sentHour ?? 0,
        sentDay: lv?.sentDay ?? 0,
        newChatsHour: lv?.newChatsHour ?? 0,
      };
    }),
  });
}
