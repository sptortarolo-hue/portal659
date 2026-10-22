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
 * WhatsApp pre-armado para el carrier (aviso de retiro): el comercio lo toca
 * y se abre su WhatsApp con el mensaje listo. Incluye links de Google Maps
 * (retiro y entrega) para que el operador navegue en un tap.
 */
export function buildCarrierWaUrl(carrierPhone: string, text: string): string | null {
  const digits = String(carrierPhone).replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Link de navegación (Maps directions, gratis — mismo patrón del sitio). */
function mapsDirUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;
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
  if (opts.storeAddress) lines.push(`↳ Navegar al retiro: ${mapsDirUrl(opts.storeAddress)}`);
  if (opts.zoneName) {
    lines.push(
      `Zona: ${opts.zoneName}${opts.etaDays ? ` (ETA ${opts.etaDays} ${opts.etaDays === 1 ? "día" : "días"})` : ""}`
    );
  }
  if (opts.customerName) lines.push(`Entregar: ${opts.customerName}`);
  if (opts.customerPhone) lines.push(`Contacto: ${opts.customerPhone}`);
  if (opts.customerAddress) {
    lines.push(`📍 ${opts.customerAddress}`);
    lines.push(`↳ Navegar a la entrega: ${mapsDirUrl(opts.customerAddress)}`);
  }
  if (opts.orderNumber) lines.push(`Pedido: ${opts.orderNumber}`);
  lines.push(`Panel operador: ${getSiteUrl()}/envios`);
  return lines.join("\n");
}

/**
 * Destinos de WhatsApp del carrier: cada teléfono de `wa_phones` (+ el
 * `phone` histórico) y, si existe, el grupo (`wa_invite_url`). Devuelve
 * [{label, url}] deduplicado: el comercio elige a quién avisarle.
 */
export function carrierWaTargets(
  carrier: { phone?: string | null; wa_phones?: string | null; wa_invite_url?: string | null } | null | undefined,
  text: string
): { label: string; url: string }[] {
  if (!carrier) return [];
  const out: { label: string; url: string }[] = [];
  const seen = new Set<string>();

  const rawPhones = [carrier.wa_phones || "", carrier.phone || ""]
    .join(",")
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  let idx = 0;
  for (const p of rawPhones) {
    const url = buildCarrierWaUrl(p, text);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    idx++;
    out.push({ label: idx === 1 ? "📲 Avisar WhatsApp" : `📲 WhatsApp ${idx}`, url });
  }

  const invite = (carrier.wa_invite_url || "").trim();
  if (invite.startsWith("http") && !seen.has(invite)) {
    seen.add(invite);
    out.push({ label: "👥 Grupo de la logística", url: invite });
  }
  return out;
}

