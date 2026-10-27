import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/vendor/wa-bot/conversations?waId= — historial de conversaciones del bot.
 * Sin waId: lista de conversaciones (agrupadas por wa_id) con último mensaje.
 * Con waId: mensajes de esa conversación.
 */
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const url = new URL(request.url);
  const waId = url.searchParams.get("waId") || "";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "50")));

  if (waId) {
    const msgs = await queryMany<{ id: string; direction: string; text: string; created_at: string }>(
      `SELECT id, direction, text, created_at
       FROM wa_bot_messages
       WHERE vendor_id = $1 AND wa_id = $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [vendor.id, waId, limit]
    ).catch(() => []);
    return NextResponse.json({ messages: msgs || [] });
  }

  const convs = await queryMany<{ wa_id: string; last_text: string; last_at: string; msg_count: string; last_direction: string }>(
    `SELECT wa_id,
            (SELECT text FROM wa_bot_messages WHERE vendor_id = $1 AND wa_id = m.wa_id ORDER BY created_at DESC LIMIT 1) AS last_text,
            MAX(created_at) AS last_at,
            COUNT(*)::text AS msg_count,
            (SELECT direction FROM wa_bot_messages WHERE vendor_id = $1 AND wa_id = m.wa_id ORDER BY created_at DESC LIMIT 1) AS last_direction
     FROM wa_bot_messages m
     WHERE vendor_id = $1
     GROUP BY wa_id
     ORDER BY MAX(created_at) DESC
     LIMIT 50`,
    [vendor.id]
  ).catch(() => []);

  return NextResponse.json({
    conversations: (convs || []).map((c) => ({
      waId: c.wa_id,
      lastText: c.last_text,
      lastAt: c.last_at,
      count: Number(c.msg_count),
      lastDirection: c.last_direction,
    })),
  });
}
