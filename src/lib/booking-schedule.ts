/**
 * Agenda de la turnera (estética): disponibilidad por profesional.
 * Client-safe (sin `pg`): la usan el micrositio, el panel y las APIs.
 *
 * Formatos:
 * - availability (semanal recurrente, jsonb): { "lun": [["09:00","13:00"],["17:00","20:00"]], ... }
 * - ajuste por fecha (staff_schedule_days.ranges): [["09:00","13:00"]] ([] = cerrado)
 * - horario del local (vendors.hours): "lun: 09:00-13:00 y 17:00-22:00, ..."
 */

import { parseWeeklyHours } from "@/lib/open-hours";

export const DAY_KEYS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"] as const;

export const WEEKDAY_ORDER = ["lun", "mar", "mie", "jue", "vie", "sab", "dom"] as const;

export const DAY_LABEL: Record<string, string> = {
  dom: "Dom",
  lun: "Lun",
  mar: "Mar",
  mie: "Mié",
  jue: "Jue",
  vie: "Vie",
  sab: "Sáb",
};

export type Range = [number, number];
export function toMinutes(t: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 24 || mm > 59) return null;
  return h * 60 + mm;
}

export function fmtMinutes(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

export function dayKeyForISO(dateISO: string): string | null {
  const d = new Date(`${dateISO}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return DAY_KEYS[d.getDay()] ?? null;
}

/** Fecha AR (YYYY-MM-DD) de hoy + offset días (TZ America/Argentina/Buenos_Aires). */
export function arToday(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Normaliza un jsonb de franjas a minutos. Acepta pares ["09:00","13:00"]
 * u objetos {start,end}; descarta lo inválido. [] o null → [].
 */
export function parsePairRanges(raw: unknown): Range[] {
  if (!Array.isArray(raw)) return [];
  const out: Range[] = [];
  for (const item of raw) {
    let a: unknown;
    let b: unknown;
    if (Array.isArray(item)) {
      a = item[0];
      b = item[1];
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      a = o.start ?? o.from ?? o[0];
      b = o.end ?? o.to ?? o[1];
    } else if (typeof item === "string") {
      const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(item.trim());
      if (m) {
        a = m[1];
        b = m[2];
      }
    }
    const s = toMinutes(a);
    const e = toMinutes(b);
    if (s != null && e != null && e > s) out.push([s, e]);
  }
  return out;
}

/** availability jsonb → { dia: ranges } (null si no es un objeto válido). */
export function parseAvailability(raw: unknown): Record<string, Range[]> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, Range[]> = {};
  let found = false;
  for (const key of WEEKDAY_ORDER) {
    if (key in src) {
      out[key] = parsePairRanges(src[key]);
      found = true;
    }
  }
  return found ? out : null;
}

/**
 * Franjas [open,close] en minutos del día pedido desde el formato del editor
 * del local ("lun: 09:00-13:00 y 17:00-22:00, ..."). NULL si no se puede parsear.
 */
export function shiftsFromHoursText(hours: string | null, dateISO: string): Range[] | null {
  if (!hours) return null;
  const key = dayKeyForISO(dateISO);
  if (!key) return null;

  // Parser semanal tolerante (mismo criterio de "Abierto ahora" del
  // micrositio): si el string matchea el formato por días, un día sin franja o
  // con "cerrado" está CERRADO ([]). Sin esto un "dom:" ausente (formato
  // legacy, franjas sin minutos, etc.) devolvía null y el server de slots
  // mostraba el día con el fallback 9-20 como si hubiese huecos.
  const weekly = parseWeeklyHours(hours);
  if (weekly) {
    const dayIdx = (DAY_KEYS as readonly string[]).indexOf(key);
    const entry = weekly.find((d) => d.dayIdx === dayIdx);
    if (!entry || entry.closed) return [];
    if (/abierto 24/i.test(entry.text)) return [[0, 24 * 60]];
    const out: Range[] = [];
    for (const seg of entry.text.split("·")) {
      const m = seg.trim().match(/^(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})$/);
      if (!m) continue;
      const a = Number(m[1]) * 60 + Number(m[2]);
      const b = Number(m[3]) * 60 + Number(m[4]);
      if (b > a) out.push([a, b]);
    }
    return out;
  }

  // Legacy sin formato por días ("lun a vie 9-18", etc.): parser estricto.
  // NULL = no se pudo parsear (estimated, fallback 9-20 en el server de slots).
  const seg = new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*([^,]+)`, "i").exec(hours);
  if (!seg) return null;
  const text = seg[1].trim().toLowerCase();
  if (/cerrado/.test(text)) return [];
  const times = [...text.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  const out: Range[] = [];
  for (let i = 0; i + 1 < times.length; i += 2) {
    if (times[i + 1] > times[i]) out.push([times[i], times[i + 1]]);
  }
  return out;
}

/**
 * Franjas de un profesional para una fecha concreta.
 * Prioridad: ajuste por fecha (aunque sea []) > disponibilidad semanal (grid)
 * > horario del local. Devuelve null si no hay ninguna fuente parseable.
 * `overrideRanges` debe pasarse `undefined` cuando NO hay ajuste para esa fecha.
 */
export function staffRangesForDate(opts: {
  mode?: string | null;
  hoursText: string | null;
  availability?: unknown;
  overrideRanges?: unknown;
  dateISO: string;
}): Range[] | null {
  if (opts.overrideRanges !== undefined && opts.overrideRanges !== null) {
    return parsePairRanges(opts.overrideRanges);
  }
  if (opts.mode === "grid") {
    const av = parseAvailability(opts.availability);
    if (av) {
      const key = dayKeyForISO(opts.dateISO);
      return key ? av[key] ?? [] : [];
    }
  }
  return shiftsFromHoursText(opts.hoursText, opts.dateISO);
}

/** ¿La franja [start,end) entra completa dentro de alguno de los rangos? */
export function fitsInRanges(ranges: Range[], start: number, end: number): boolean {
  return ranges.some(([o, c]) => start >= o && end <= c);
}

const MAX_RANGES = 6;

/** Valida el input de `availability` (grilla semanal) del panel. */
export function validateAvailabilityInput(raw: unknown):
  | { ok: true; value: Record<string, [string, string][]> }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Formato de disponibilidad inválido" };
  }
  const src = raw as Record<string, unknown>;
  const value: Record<string, [string, string][]> = {};
  for (const key of WEEKDAY_ORDER) {
    if (!(key in src)) continue;
    const arr = src[key];
    if (!Array.isArray(arr)) return { ok: false, error: `Día ${key}: formato inválido` };
    if (arr.length > MAX_RANGES) return { ok: false, error: `Día ${key}: máximo ${MAX_RANGES} franjas` };
    const pairs: [string, string][] = [];
    for (const item of arr) {
      const a = Array.isArray(item) ? item[0] : undefined;
      const b = Array.isArray(item) ? item[1] : undefined;
      const s = /^(\d{2}):(\d{2})$/.exec(String(a || ""));
      const e = /^(\d{2}):(\d{2})$/.exec(String(b || ""));
      if (!s || !e) return { ok: false, error: `Día ${key}: horario inválido (usá HH:MM)` };
      const sm = Number(s[1]) * 60 + Number(s[2]);
      const em = Number(e[1]) * 60 + Number(e[2]);
      if (sm >= em) return { ok: false, error: `Día ${key}: el cierre debe ser posterior a la apertura` };
      pairs.push([`${s[1]}:${s[2]}`, `${e[1]}:${e[2]}`]);
    }
    value[key] = pairs;
  }
  return { ok: true, value };
}

/** Valida el input de rangos de un día puntual (staff_schedule_days). */
export function validateDayRangesInput(raw: unknown):
  | { ok: true; value: [string, string][] }
  | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "Formato de franjas inválido" };
  if (raw.length > MAX_RANGES) return { ok: false, error: `Máximo ${MAX_RANGES} franjas` };
  const pairs: [string, string][] = [];
  for (const item of raw) {
    const a = Array.isArray(item) ? item[0] : undefined;
    const b = Array.isArray(item) ? item[1] : undefined;
    const s = /^(\d{2}):(\d{2})$/.exec(String(a || ""));
    const e = /^(\d{2}):(\d{2})$/.exec(String(b || ""));
    if (!s || !e) return { ok: false, error: "Horario inválido (usá HH:MM)" };
    const sm = Number(s[1]) * 60 + Number(s[2]);
    const em = Number(e[1]) * 60 + Number(e[2]);
    if (sm >= em) return { ok: false, error: "El cierre debe ser posterior a la apertura" };
    pairs.push([`${s[1]}:${s[2]}`, `${e[1]}:${e[2]}`]);
  }
  return { ok: true, value: pairs };
}

export const SLOT_STEP_MIN = 30;

// ---------------------------------------------------------------------------
// Semana (lunes→domingo) — usado por el picker del cliente y el planner.
// ---------------------------------------------------------------------------

function toISODateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Suma/resta días a un ISO "YYYY-MM-DD" (mediodía, seguro contra TZ). */
export function shiftISODate(dateISO: string, delta: number): string {
  const d = new Date(`${dateISO}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateISO;
  d.setDate(d.getDate() + delta);
  return toISODateLocal(d);
}

/** Lunes de la semana que contiene `dateISO`. */
export function startOfWeekISO(dateISO: string): string {
  const d = new Date(`${dateISO}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateISO;
  const offset = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - offset);
  return toISODateLocal(d);
}

/** Los 7 ISO (lun→dom) de la semana que arranca en `startISO`. */
export function weekDatesISO(startISO: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftISODate(startISO, i));
}

/** "dd/mm" corto para chips/encabezados. */
export function fmtDateShort(dateISO: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  return m ? `${m[3]}/${m[2]}` : dateISO;
}

// ---------------------------------------------------------------------------
// Grilla de slots (bloques de 30 min) — planner del panel.
// La grilla representa la VENTANA de disponibilidad del profesional; la
// duración del servicio manda al ofrecer horarios (lo resuelve el server).
// ---------------------------------------------------------------------------

export const PLANNER_START_MIN = 7 * 60;
export const PLANNER_END_MIN = 22 * 60;

function snapDown(min: number): number {
  return Math.max(0, Math.floor(min / SLOT_STEP_MIN) * SLOT_STEP_MIN);
}
function snapUp(min: number): number {
  return Math.min(24 * 60, Math.ceil(min / SLOT_STEP_MIN) * SLOT_STEP_MIN);
}

/** availability jsonb → { dia: Set(minutos de inicio marcados, paso 30) }.
 *  Las franjas con bordes fuera de :00/:30 se ajustan hacia afuera. */
export function availabilityToSlotMap(raw: unknown): Record<string, Set<number>> {
  const av = parseAvailability(raw) ?? {};
  const out: Record<string, Set<number>> = {};
  for (const day of WEEKDAY_ORDER) {
    const set = new Set<number>();
    for (const [o, c] of av[day] || []) {
      for (let t = snapDown(o); t + SLOT_STEP_MIN <= snapUp(c); t += SLOT_STEP_MIN) set.add(t);
    }
    out[day] = set;
  }
  return out;
}

/** { dia: Set(minutos) } → availability jsonb (franjas contiguas, máx 6/día). */
export function slotMapToAvailability(map: Record<string, Set<number>>): Record<string, [string, string][]> {
  const out: Record<string, [string, string][]> = {};
  for (const day of WEEKDAY_ORDER) {
    const mins = [...(map[day] || new Set<number>())].filter((m) => Number.isFinite(m)).sort((a, b) => a - b);
    const ranges: [string, string][] = [];
    let start: number | null = null;
    let prev: number | null = null;
    for (const m of mins) {
      if (start == null || prev == null) {
        start = m;
        prev = m;
        continue;
      }
      if (m === prev + SLOT_STEP_MIN) {
        prev = m;
        continue;
      }
      ranges.push([fmtMinutes(start), fmtMinutes(prev + SLOT_STEP_MIN)]);
      start = m;
      prev = m;
    }
    if (start != null && prev != null) ranges.push([fmtMinutes(start), fmtMinutes(prev + SLOT_STEP_MIN)]);
    out[day] = ranges.slice(0, 6);
  }
  return out;
}

/** Ventana de la grilla (07–22 por defecto, expandida si hay franjas fuera). */
export function plannerWindow(map: Record<string, Set<number>>): { start: number; end: number } {
  let start = PLANNER_START_MIN;
  let end = PLANNER_END_MIN;
  for (const day of WEEKDAY_ORDER) {
    for (const m of map[day] || []) {
      if (m < start) start = Math.max(0, m);
      if (m + SLOT_STEP_MIN > end) end = Math.min(24 * 60, m + SLOT_STEP_MIN);
    }
  }
  return { start, end };
}

/** Horario del local (texto) → mapa de slots (prefill del planner). */
export function hoursTextToSlotMap(hours: string | null): Record<string, Set<number>> {
  const out: Record<string, Set<number>> = {};
  const monday = "2024-01-01"; // lunes de referencia
  for (let i = 0; i < 7; i++) {
    const iso = shiftISODate(monday, i);
    const key = dayKeyForISO(iso) || "lun";
    const set = new Set<number>();
    for (const [o, c] of shiftsFromHoursText(hours, iso) || []) {
      for (let t = snapDown(o); t + SLOT_STEP_MIN <= snapUp(c); t += SLOT_STEP_MIN) set.add(t);
    }
    out[key] = set;
  }
  return out;
}

/** Etiqueta del rango que ocuparía un turno: "10:00–11:30". */
export function slotRangeLabel(time: string, durationMin: number | null | undefined): string | null {
  const t = toMinutes(time);
  const dur = Number(durationMin);
  if (t == null || !Number.isFinite(dur) || dur <= 0) return null;
  return `${time}–${fmtMinutes(Math.min(24 * 60, t + dur))}`;
}
