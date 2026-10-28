import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { query, queryMany, queryOne } from "@/lib/db";

/**
 * POST /api/wa/messages — el cerebro del bot registra un mensaje (entrante o
 * saliente) para el historial de conversaciones. Best-effort.
 * Body: { vendorId, waId, direction: "in"|"out", text, ts? }
 * o: { vendorId, messages: [{ waId, direction, text, ts? }] } (batch)
 */
export async function POST(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch { body = null; }
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  const vendorId = body.vendorId;
  if (!vendorId) return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });

  const msgs = Array.isArray(body.messages) ? body.messages : [body];
  if (msgs.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

  const batch = msgs.slice(0, 50);
  let inserted = 0;
  for (const m of batch) {
    const waId = String(m?.waId || "").replace(/@.*/, "");
    const direction = m?.direction === "out" ? "out" : "in";
    const text = String(m?.text || "").slice(0, 2000);
    if (!waId || !text) continue;
    const ts = m?.ts ? new Date(Number(m.ts)) : new Date();
    try {
      await query(
        `INSERT INTO wa_bot_messages (vendor_id, wa_id, direction, text, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [vendorId, waId, direction, text, ts]
      );
      inserted++;
    } catch {
      // best-effort: tabla sin migrar o error de DB
    }
  }

  return NextResponse.json({ ok: true, inserted });
}

/**
 * GET /api/wa/messages?vendorId=&waId=&limit=50 — historial de mensajes.
 * Si se pasa waId, devuelve los mensajes de esa conversación.
 * Si no, devuelve la lista de conversaciones (agrupadas por wa_id) con el
 * último mensaje y conteo.
 */
export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId") || "";
  const waId = url.searchParams.get("waId") || "";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "50")));
  if (!vendorId) return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });

  if (waId) {
    // Mensajes de una conversación específica.
    const msgs = await queryMany<{ id: string; direction: string; text: string; created_at: string }>(
      `SELECT id, direction, text, created_at
       FROM wa_bot_messages
       WHERE vendor_id = $1 AND wa_id = $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [vendorId, waId, limit]
    ).catch(() => []);
    return NextResponse.json({ messages: msgs || [] });
  }

  // Lista de conversaciones (agrupadas por wa_id) con último mensaje.
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
    [vendorId]
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
