/**
 * Fechas fiscales en hora de Argentina.
 *
 * El VPS corre en UTC: `getFullYear()/getMonth()/getDate()` sellan el día
 * siguiente a partir de las 21:00 AR. ARCA espera la fecha en hora local,
 * así que todo lo que viaja en WSFE / QR se calcula con Intl + TZ AR.
 * Autocontenido y client-safe (mismo patrón que `src/lib/expiry.ts`).
 */
const AR_TZ = "America/Argentina/Buenos_Aires";

function arParts(at: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Fecha de emisión para ARCA en formato YYYYMMDD. */
export function arYYYYMMDD(at: Date = new Date()): string {
  const { year, month, day } = arParts(at);
  return `${year}${month}${day}`;
}

/** Fecha de emisión para el payload del QR en formato YYYY-MM-DD. */
export function arFechaISO(at: Date = new Date()): string {
  const { year, month, day } = arParts(at);
  return `${year}-${month}-${day}`;
}
