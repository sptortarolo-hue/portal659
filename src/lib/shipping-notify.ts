/**
 * Notificaciones del circuito Portal 659 Envíos (server-side).
 *
 * - Aviso a la logística: al crear el encargo, push + aviso in-app a todos
 *   los operadores activos del carrier (misma cuenta compartida: el primero
 *   que abra el panel lo ve).
 * - WhatsApp al carrier: link wa.me pre-armado con los datos del retiro
 *   (mismo patrón que los avisos al cliente).
 */
import { queryMany, queryOne } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import { getSiteUrl } from "@/lib/site-url";

export async function notifyCarrierOperators(
  carrierId: string | null | undefined,
  info: { code: string; zoneName?: string | null; storeName?: string | null }
): Promise<number> {
  if (!carrierId) return 0;
  let profiles: { profile_id: string }[] = [];
  try {
    profiles =
      (await queryMany<{ profile_id: string }>(
        `SELECT o.profile_id FROM carrier_operators o
         JOIN carriers c ON c.id = o.carrier_id
         WHERE o.carrier_id = $1 AND o.active = true AND c.active = true`,
        [carrierId]
      )) || [];
  } catch {
    return 0;
  }
  const site = getSiteUrl();
  let pushed = 0;
  for (const p of profiles) {
    try {
      const title = `🚚 Nueva toma — ${info.code}`;
      const body = `Retiro en ${info.storeName || "el comercio"}${
        info.zoneName ? ` · zona ${info.zoneName}` : ""
      }. Panel: ${site}/envios`;
      await queryOne(
        `INSERT INTO notifications (user_id, title, body, type, link)
         VALUES ($1, $2, $3, 'order', '/envios')`,
        [p.profile_id, title, body]
      );
      await sendPushToUser(p.profile_id, { title, body, link: "/envios" });
      pushed++;
    } catch {
      /* best-effort por operador */
    }
  }
  return pushed;
}

/**
 * WhatsApp pre-armado para el carrier (aviso de retiro). Los datos del
 * comprador van con puntos para un segundo sync (después del evento push).
 */
export function buildCarrierWaUrl(carrierPhone: string, text: string): string | null {
  const digits = String(carrierPhone).replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function carrierWaText(opts: {
  code: string;
  storeName: string | null;
  storeAddress: string | null;
  zoneName: string | null;
  etaDays: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  orderNumber: string | null;
}): string {
  const lines = [
    `🚚 Portal 659 Envíos — encargo ${opts.code}`,
    `Retiro: ${opts.storeName || "el comercio"}${opts.storeAddress ? `, ${opts.storeAddress}` : ""}`,
  ];
  if (opts.zoneName) {
    lines.push(
      `Zona: ${opts.zoneName}${opts.etaDays ? ` (ETA ${opts.etaDays} ${opts.etaDays === 1 ? "día" : "días"})` : ""}`
    );
  }
  if (opts.customerName) lines.push(`Entregar: ${opts.customerName}`);
  if (opts.customerPhone) lines.push(`Contacto: ${opts.customerPhone}`);
  if (opts.customerAddress) lines.push(`📍 ${opts.customerAddress}`);
  if (opts.orderNumber) lines.push(`Pedido: ${opts.orderNumber}`);
  lines.push(`Panel operador: ${getSiteUrl()}/envios`);
  return lines.join("\n");
}
