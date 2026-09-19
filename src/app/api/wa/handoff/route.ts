import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { authWaBot } from "@/lib/wa-bot";

/**
 * POST /api/wa/handoff — el bot de WhatsApp detectó que el cliente quiere
 * hablar con una persona (o que no lo entiende 2 veces seguidas). Se crea una
 * notificación + push al dueño y el bot queda en pausa en ese chat 30 min.
 */
export async function POST(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const vendorId = body?.vendorId;
  const waId = String(body?.waId || "");
  const lastMessage = String(body?.lastMessage || "").slice(0, 200);

  if (!vendorId || !waId) {
    return NextResponse.json({ error: "vendorId y waId requeridos" }, { status: 400 });
  }

  const vendor = await queryOne<{ user_id: string; store_name: string }>(
    `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );
  if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });

  const phoneDigits = waId.replace(/[^\d]/g, "");
  const contact = phoneDigits || waId;

  await queryOne(
    `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      vendor.user_id,
      "🗣️ Un cliente quiere hablar con vos",
      `En el WhatsApp del bot: ${contact}${lastMessage ? ` — "${lastMessage}"` : ""}. Contestale desde tu WhatsApp (el bot queda en pausa 30 min).`,
      "wa_handoff",
      "/vendor/dashboard",
    ]
  );

  try {
    const { sendPushToUser } = await import("@/lib/push");
    await sendPushToUser(vendor.user_id, {
      title: "🗣️ Un cliente quiere hablar con vos",
      body: `En el WhatsApp del bot: ${contact}${lastMessage ? ` — "${lastMessage}"` : ""}. Contestale desde tu WhatsApp.`,
      link: "/vendor/dashboard",
    });
  } catch {
    // push best-effort
  }

  return NextResponse.json({ ok: true });
}
