import webpush from "web-push";
import { queryMany, query } from "./db";
import { VENDOR_ALERT_VIBRATE } from "./sounds";

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

export type PushUrgency = "very-low" | "low" | "normal" | "high";

export type PushPayload = {
  title: string;
  body?: string;
  icon?: string;
  link?: string;
  /** Tag de agrupación. Default "portal659". Para eventos que no deben
   *  colapsar (pedido nuevo), pasar uno único (ej. `new-order-<id>`). */
  tag?: string;
  /** Volver a sonar/vibrar aunque haya otra notificación con el mismo tag. */
  renotify?: boolean;
  /** La notificación queda fija hasta que el usuario la toque/cierre
   *  (clave en cocina: no se auto-descarta). */
  requireInteraction?: boolean;
  /** Patrón de vibración (Android). Default en el SW si no se pasa. */
  vibrate?: number[];
  /** Prioridad de entrega (header `Urgency`). Pedidos: "high". */
  urgency?: PushUrgency;
  /** TTL en segundos (cuánto guarda el push server si el celu está offline). */
  ttl?: number;
};

/** Re-export client-safe (los componentes client lo importan de `@/lib/sounds`). */
export { VENDOR_ALERT_VIBRATE };

/**
 * Envía un push a todas las suscripciones de un usuario.
 * Best-effort: si una suscripción está muerta (410 Gone), la elimina.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!isPushConfigured()) return;
  ensureConfigured();

  const subs = await queryMany<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId]
  );
  if (subs.length === 0) return;

  const data = JSON.stringify({
    title: payload.title,
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.png",
    tag: payload.tag || "portal659",
    renotify: payload.renotify ?? false,
    requireInteraction: payload.requireInteraction ?? false,
    vibrate: payload.vibrate ?? VENDOR_ALERT_VIBRATE,
    silent: false,
    ...(payload.link ? { link: payload.link } : {}),
  });

  const options: { TTL?: number; headers?: Record<string, string> } = {};
  if (payload.ttl != null) options.TTL = payload.ttl;
  if (payload.urgency) options.headers = { Urgency: payload.urgency };

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        data,
        options
      );
    } catch (e: any) {
      // 404/410: suscripción inválida → limpiar
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await query(`DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
      }
    }
  }
}