/**
 * Mensaje ÚNICO de recordatorio de turno (panel, WhatsApp y push).
 *
 * Un solo texto para todos los canales: botón "💬 Recordar" del panel,
 * "📲 Enviar" de la tarjeta del turno y los recordatorios automáticos del
 * cron (T-24 y T-2). La única variable es la referencia temporal
 * ("de mañana" / "de hoy" / "del 03/11") y el link de `/turno/[token]`,
 * que deja a la clienta confirmar, reprogramar o cancelar sin cuenta.
 *
 * Client-safe a propósito (no importa `pg` ni nada de servidor): el
 * `origin` se pasa desde afuera porque el cron no conoce `window`.
 */

const AR_TZ = "America/Argentina/Buenos_Aires";

/** Fecha ISO (YYYY-MM-DD) de hoy (o de hoy + N días) en hora argentina. */
function arISODate(offsetDays = 0): string {
  const base = new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (!offsetDays) return base;
  const [y, m, d] = base.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

/**
 * Referencia temporal del turno según su fecha:
 * "de hoy" | "de mañana" | "del 03/11".
 */
export function bookingWhenLabel(dateISO?: string | null): string {
  const iso = String(dateISO || "").slice(0, 10);
  if (!iso) return "";
  if (iso === arISODate(0)) return "de hoy";
  if (iso === arISODate(1)) return "de mañana";
  const [, m, d] = iso.split("-");
  if (!m || !d) return "";
  return `del ${d}/${m}`;
}

export type BookingReminderOptions = {
  customerName?: string | null;
  /** "de mañana" | "de hoy" | "del 03/11" (ver `bookingWhenLabel`). */
  when?: string | null;
  /** Hora del turno (HH:MM o HH:MM:SS). */
  time?: string | null;
  storeName?: string | null;
  /** Dominio del portal (https://www.portal659.com.ar). Vacío = sin link. */
  origin?: string | null;
  /** `bookings.confirm_token` (link público de `/turno/[token]`). */
  token?: string | null;
  /** Link de la ficha (solo T-24 cuando el comercio lo tiene activado). */
  fichaUrl?: string | null;
  /** false = no pegar la URL cruda (push: el link viaja en la notificación). */
  withLink?: boolean;
};

/**
 * Texto del recordatorio de turno. Mismo cuerpo en todos los canales.
 *
 * Ejemplo:
 * `Hola Ana! Te recordamos tu turno de mañana 10:30 en Estética del barrio.
 *  Confirmá, reprogramá o cancelá acá: https://www.portal659.com.ar/turno/abc123`
 */
export function bookingReminderMessage(opts: BookingReminderOptions): string {
  const first = String(opts.customerName || "").trim().split(" ")[0] || "";
  const time = String(opts.time || "").slice(0, 5);
  const when = String(opts.when || "").trim();
  const store = String(opts.storeName || "").trim();
  const token = String(opts.token || "").trim();
  const origin = String(opts.origin || "").replace(/\/+$/, "");

  const head =
    `Hola${first ? ` ${first}` : ""}! Te recordamos tu turno` +
    `${when ? ` ${when}` : ""}${time ? ` ${time}` : ""}` +
    `${store ? ` en ${store}` : ""}.`;

  const tail =
    token && opts.withLink !== false && origin
      ? `Confirmá, reprogramá o cancelá acá: ${origin}/turno/${token}`
      : token
        ? `Confirmá, reprogramá o cancelá tocando esta notificación.`
        : `Si necesitás cambiarlo, escribinos.`;

  const ficha = opts.fichaUrl
    ? `\nCompletá tu ficha antes de venir: ${opts.fichaUrl}`
    : "";

  return `${head} ${tail}${ficha}`;
}
