/**
 * Agenda de turnos (estética / servicios): helpers de layout para la vista
 * calendario del panel. Client-safe (sin `pg`).
 *
 * Fuentes de hora: `booking_time` ("HH:MM", hora local del local) con fallback
 * a `starts_at` (timestamptz) interpretado en TZ Argentina. Duración:
 * `duration_min` > (ends_at − starts_at) > 60 min.
 */

export const AGENDA_START_HOUR = 7;
export const AGENDA_END_HOUR = 22;
/** Altura de una hora en px (la grilla escala por minuto). */
export const HOUR_HEIGHT = 56;
export const PX_PER_MIN = HOUR_HEIGHT / 60;
export const MIN_BLOCK_PX = 24;
export const DEFAULT_DURATION_MIN = 60;

export type AgendaBooking = {
  id: string;
  booking_date?: string | null;
  booking_time?: string | null;
  duration_min?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: string | null;
  staff_id?: string | null;
  [key: string]: unknown;
};

export type AgendaStaff = { id: string; name: string };

const AR_TZ = "America/Argentina/Buenos_Aires";

export function timeToMinutes(t: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 24 || mm > 59) return null;
  return h * 60 + mm;
}

export function minutesToLabel(mins: number): string {
  const m = Math.max(0, mins);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function isoPartsInAr(d: Date): { hh: number; mm: number } | null {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: AR_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hh = Number(parts.find((p) => p.type === "hour")?.value);
  const mm = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return { hh, mm };
}

/** Minutos desde las 00:00 de la hora de inicio del turno (o null). */
export function bookingStartMinutes(b: AgendaBooking): number | null {
  const t = timeToMinutes(b.booking_time);
  if (t != null) return t;
  if (typeof b.starts_at === "string" && b.starts_at) {
    const d = new Date(b.starts_at);
    if (!Number.isNaN(d.getTime())) {
      const p = isoPartsInAr(d);
      if (p) return p.hh * 60 + p.mm;
    }
  }
  return null;
}

export function bookingDurationMinutes(b: AgendaBooking): number {
  const dur = Number(b.duration_min);
  if (Number.isFinite(dur) && dur > 0) return dur;
  if (typeof b.starts_at === "string" && typeof b.ends_at === "string" && b.starts_at && b.ends_at) {
    const s = new Date(b.starts_at).getTime();
    const e = new Date(b.ends_at).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) return Math.round((e - s) / 60000);
  }
  return DEFAULT_DURATION_MIN;
}

/** Ahora en minutos (TZ AR) para la línea de "ahora". */
export function arNowMinutes(at: Date = new Date()): number {
  const p = isoPartsInAr(at);
  return p ? p.hh * 60 + p.mm : 0;
}

/** Ventana horaria de la grilla, expandida si hay turnos fuera de 07–22. */
export function agendaWindow(bookings: AgendaBooking[]): { startMin: number; endMin: number } {
  let start = AGENDA_START_HOUR * 60;
  let end = AGENDA_END_HOUR * 60;
  for (const b of bookings) {
    const s = bookingStartMinutes(b);
    if (s == null) continue;
    const e = s + bookingDurationMinutes(b);
    if (s < start) start = Math.max(0, Math.floor(s / 60) * 60);
    if (e > end) end = Math.min(24 * 60, Math.ceil(e / 60) * 60);
  }
  return { startMin: start, endMin: Math.max(end, start + 60) };
}

export function blockTop(startMin: number, windowStartMin: number): number {
  return Math.max(0, (startMin - windowStartMin) * PX_PER_MIN);
}

export function blockHeight(durationMin: number): number {
  return Math.max(durationMin * PX_PER_MIN - 2, MIN_BLOCK_PX);
}

/** Clases Tailwind del bloque según estado (borde izquierdo grueso + fondo). */
export function statusTone(status: unknown): string {
  switch (String(status || "")) {
    case "confirmed":
      return "border-emerald-400 bg-emerald-50 text-emerald-900 hover:bg-emerald-100";
    case "pending":
      return "border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100";
    case "noshow":
      return "border-orange-400 bg-orange-50 text-orange-900 hover:bg-orange-100";
    case "cancelled":
      return "border-border bg-muted text-muted-foreground hover:bg-muted/70";
    default:
      return "border-border bg-muted text-foreground hover:bg-muted/70";
  }
}

export type AgendaColumn = { id: string; name: string; bookings: AgendaBooking[] };

/**
 * Carriles de la vista Día: una columna por profesional (en el orden dado) más
 * una columna "Sin asignar" para turnos sin `staff_id` o de un staff inactivo.
 */
export function buildDayColumns(
  bookings: AgendaBooking[],
  dateISO: string,
  staff: AgendaStaff[]
): AgendaColumn[] {
  const byStaff = new Map<string, AgendaBooking[]>();
  const unassigned: AgendaBooking[] = [];
  const known = new Set(staff.map((s) => s.id));

  for (const b of bookings) {
    if ((b.booking_date || "") !== dateISO) continue;
    if (bookingStartMinutes(b) == null) continue;
    const sid = typeof b.staff_id === "string" ? b.staff_id : null;
    if (sid && known.has(sid)) {
      const arr = byStaff.get(sid) || [];
      arr.push(b);
      byStaff.set(sid, arr);
    } else {
      unassigned.push(b);
    }
  }

  const sortByTime = (a: AgendaBooking, b: AgendaBooking) =>
    (bookingStartMinutes(a) ?? 0) - (bookingStartMinutes(b) ?? 0);
  for (const arr of byStaff.values()) arr.sort(sortByTime);
  unassigned.sort(sortByTime);

  const cols: AgendaColumn[] = staff.map((s) => ({
    id: s.id,
    name: s.name,
    bookings: byStaff.get(s.id) || [],
  }));
  if (unassigned.length > 0 || cols.length === 0) {
    cols.push({ id: "", name: staff.length === 0 ? "Turnos" : "Sin asignar", bookings: unassigned });
  }
  return cols;
}

/** Agrupa por `booking_date` (clave "Sin fecha" si falta). */
export function groupByDate(bookings: AgendaBooking[]): Record<string, AgendaBooking[]> {
  const out: Record<string, AgendaBooking[]> = {};
  for (const b of bookings) {
    const date = (b.booking_date as string) || "Sin fecha";
    if (!out[date]) out[date] = [];
    out[date].push(b);
  }
  return out;
}

export function formatDayLabel(dateISO: string): string {
  const d = new Date(`${dateISO}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateISO;
  const s = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Suma/resta días a un ISO "YYYY-MM-DD" (mediodía, seguro contra TZ). */
export function addDaysISO(dateISO: string, delta: number): string {
  const d = new Date(`${dateISO}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}
