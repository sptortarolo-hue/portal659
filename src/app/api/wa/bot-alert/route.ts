import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { queryMany, queryOne } from "@/lib/db";

/**
 * POST /api/wa/bot-alert — el cerebro del bot avisa que algo se rompió en un
 * comercio (ej: LoggedOut de Meta). Notifica a TODOS los admins del portal
 * (in-app + push) con la guía: el número quedó "caliente" y hay que revisar la
 * app de WhatsApp por avisos de Meta ANTES de re-vincular.
 */
export async function POST(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const vendorId = body?.vendorId;
  const storeName = String(body?.storeName || "Un comercio");
  const kind = String(body?.kind || "logged_out");
  if (!vendorId) {
    return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });
  }

  const title =
    kind === "logged_out"
      ? `🚨 Bot de WhatsApp desconectado — ${storeName}`
      : `⚠️ Bot de WhatsApp — ${storeName}`;
  const bodyText =
    kind === "logged_out"
      ? `Meta desconectó el bot de ${storeName}. ANTES de re-vincular: abrí tu app de WhatsApp y fijate si tenés algún aviso de Meta. Si llegó un aviso, esperá 24-48h antes de volver a vincular.`
      : `El bot de ${storeName} reportó un evento (${kind}). Revisá el tablero de bots.`;

  const admins = await queryMany<{ id: string }>(
    `SELECT id FROM profiles WHERE is_admin = true`,
    []
  ).catch(() => []);

  for (const admin of admins || []) {
    try {
      await queryOne(
        `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [admin.id, title, bodyText, "wa_bot_alert", "/admin/bots"]
      );
      const { sendPushToUser } = await import("@/lib/push");
      await sendPushToUser(admin.id, {
        title,
        body: bodyText,
        link: "/admin/bots",
      }).catch(() => {});
    } catch {
      // best-effort por admin
    }
  }

  return NextResponse.json({ ok: true, notified: (admins || []).length });
}
