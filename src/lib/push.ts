import webpush from "web-push";
import { queryMany, query } from "./db";

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:noreply@portal659.com.ar";

let configured = false;

function ensureConfigured() {
  if (!configured && PUBLIC_KEY && PRIVATE_KEY) {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  }
}

export function isPushConfigured(): boolean {
  return Boolean(PUBLIC_KEY && PRIVATE_KEY);
}

type PushPayload = { title: string; body?: string; icon?: string; link?: string };

/**
 * Envía un push a todas las suscripciones de un usuario.
 * Best-effort: si una suscripción está muerta (410 Gone), la elimina.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!isPushConfigured()) return;

  const subs = await queryMany<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId]
  );
  if (subs.length === 0) return;

  const data = JSON.stringify({
    title: payload.title,
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.png",
    tag: "portal659",
    ...(payload.link ? { link: payload.link } : {}),
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        data
      );
    } catch (e: any) {
      // 404/410: suscripción inválida → limpiar
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
      }
    }
  }
}