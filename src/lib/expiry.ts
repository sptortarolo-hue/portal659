const AR_TZ = "America/Argentina/Buenos_Aires";

export type ExpiryStatus = "expired" | "soon" | "ok" | "none";

export type ExpiryInfo = {
  days: number | null;
  status: ExpiryStatus;
};

/** Fecha de hoy (YYYY-MM-DD) en la zona horaria del portal. */
export function todayISOInAR(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Valida una fecha de calendario en formato YYYY-MM-DD. */
export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Normaliza un date/string de Postgres a YYYY-MM-DD (o null). */
export function toDateOnly(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  const head = s.slice(0, 10);
  if (isValidDateOnly(head)) return head;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : toDateOnly(parsed);
}

function isoToUTC(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Días de calendario hasta el vencimiento (negativo = vencido). */
export function daysUntilExpiry(dateISO: string | null | undefined, at: Date = new Date()): number | null {
  const date = toDateOnly(dateISO);
  if (!date) return null;
  return Math.round((isoToUTC(date) - isoToUTC(todayISOInAR(at))) / 86400000);
}

/** Estado de un vencimiento según el umbral global del comercio. */
export function expiryStatus(
  dateISO: string | null | undefined,
  thresholdDays = 7,
  at: Date = new Date()
): ExpiryInfo {
  const days = daysUntilExpiry(dateISO, at);
  if (days == null) return { days: null, status: "none" };
  if (days < 0) return { days, status: "expired" };
  const threshold = Math.max(0, Number(thresholdDays) || 0);
  return { days, status: days <= threshold ? "soon" : "ok" };
}

export function expiryLabel(dateISO: string | null | undefined, at: Date = new Date()): string {
  const days = daysUntilExpiry(dateISO, at);
  if (days == null) return "Sin vencimiento";
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence mañana";
  if (days > 1) return `Vence en ${days} días`;
  if (days === -1) return "Vencido ayer";
  return `Vencido hace ${Math.abs(days)} días`;
}

export function formatDateAR(dateISO: string | null | undefined): string {
  const date = toDateOnly(dateISO);
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}
