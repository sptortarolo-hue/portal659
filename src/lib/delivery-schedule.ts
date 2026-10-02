/**
 * Franjas de reparto retail (moda + comercio). Client-safe: sin imports de
 * servidor, lo usan el checkout (espejo visual), el micrositio y el server
 * (`delivery-availability` + `order-service` importan solo estas funciones
 * puras + `delivery-server` para la config).
 *
 * Sin cupo por turno en esta versión: el cliente elige entre los próximos
 * 3 turnos con lugar implícito. Fuera de horario no se bloquea: el pedido
 * entra con el próximo turno (aviso amable + alternativa de retiro).
 *
 * Formato de horarios: el mismo del `HoursEditor`
 * ("lun: 09:00-13:00 y 17:00-22:00, mar: 09:00-18:00, ...").
 * `delivery_hours = null` = "mismo horario del local" (`hours`).
 *
 * Override + días especiales (migración migrate-delivery-schedule-override):
 * `delivery_override` (forzar abierto / pausa blanda con `paused_until` +
 * motivo opcional) y `delivery_extra_days` (extender o agregar franjas por
 * fecha: Hoy/Mañana/+7). La pausa es blanda: el pedido sigue entrando con
 * el próximo turno.
 */

export const DELIVERY_TZ = "America/Argentina/Buenos_Aires";
export const DELIVERY_DEFAULT_PREP_MIN = 60;
export const DELIVERY_SLOTS_OFFERED = 3;
/** Tope de días especiales hacia adelante (Hoy/Mañana/+7). */
export const DELIVERY_EXTRA_MAX_DAYS = 8;
export const DELIVERY_EXTRA_MAX_ENTRIES = 7;

export type DayShift = { open: number; close: number }; // minutos desde 00:00

export type DeliverySlot = {
  /** "2026-10-03|09:00-13:00" — es lo que viaja en `orders.delivery_window`. */
  id: string;
  /** "2026-10-03" (fecha del turno en TZ reparto). */
  dateISO: string;
  /** "hoy 17:00–20:00" / "mañana 09:00–13:00" / "lun 09:00–13:00". */
  label: string;
  /** Rango tal cual: "17:00–20:00". */
  range: string;
  isToday: boolean;
  isTomorrow: boolean;
};

/** Día especial: {open,close} reemplaza la franja; solo {close} la extiende. */
export type DeliveryExtraDay = { open?: string | null; close?: string | null };

/** Motivos de pausa (código corto en DB → label panel + mensaje cliente). */
export const DELIVERY_PAUSE_REASONS: Record<string, { label: string; clientMsg: string | null }> = {
  saturado: { label: "Con muchos pedidos", clientMsg: "Estamos con muchos pedidos 🙏" },
  sin_repartidor: { label: "Sin repartidor", clientMsg: "Nos quedamos sin repartidor por ahora 🛵" },
  cierra_temprano: { label: "Cierra temprano hoy", clientMsg: "Hoy cerramos el reparto más temprano 😴" },
  otro: { label: "Otro motivo", clientMsg: null },
};

type VendorSchedule = {
  hours?: string | null;
  delivery_hours?: string | null;
  open_override?: boolean | null;
  /** null=según horario, true=forzar abierto, false=pausado (blando). */
  delivery_override?: boolean | null;
  /** Auto-resume (ISO). NULL = hasta reanudar a mano. Vencido = se ignora. */
  delivery_paused_until?: string | null;
  delivery_pause_reason?: string | null;
  /** Días especiales {"YYYY-MM-DD": {open?, close?}}. */
  delivery_extra_days?: Record<string, DeliveryExtraDay> | null;
};

const DAY_TOKEN: Record<string, number> = {
  dom: 0, domingo: 0,
  lun: 1, lunes: 1,
  mar: 2, martes: 2,
  mie: 3, miercoles: 3,
  jue: 4, jueves: 4,
  vie: 5, viernes: 5,
  sab: 6, sabado: 6,
};

const WEEKDAY_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function toMinutes(h: string, m: string | undefined, mer: string | undefined): number | null {
  let hh = parseInt(h, 10);
  if (Number.isNaN(hh)) return null;
  const mm = parseInt(m || "0", 10) || 0;
  const ml = mer?.toLowerCase();
  if (ml === "pm" && hh < 12) hh += 12;
  if (ml === "am" && hh === 12) hh = 0;
  if (hh < 0 || hh > 24 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

const RANGE_RE =
  /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:[-–]|\ba\b)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

/** "lun: 09:00-13:00 y 17:00-22:00, ..." → turnos por día (0=dom..6=sáb). */
export function parseDeliveryShifts(text: string | null | undefined): Map<number, DayShift[]> {
  const out = new Map<number, DayShift[]>();
  if (!text || !text.trim()) return out;
  const s = text.trim();
  if (/\b24\s*(hs|horas|\/7)\b/i.test(s) || /todo el d[ií]a/i.test(s)) {
    for (let d = 0; d < 7; d++) out.set(d, [{ open: 0, close: 24 * 60 - 1 }]);
    return out;
  }
  const parts = s.split(/[,;]\s*/).map((p) => p.trim()).filter(Boolean);
  let matchedDayPart = false;
  for (const part of parts) {
    if (/cerrado/i.test(part) || /^n\/a$/i.test(part)) {
      // Día cerrado explícito ("mié: cerrado"): se marca para que el turno
      // no herede nada de un fallback genérico.
      const dm = part.match(/^([a-záéíóúñ]+)\s*:/i);
      if (dm) {
        const day = DAY_TOKEN[norm(dm[1]).trim()];
        if (day !== undefined) {
          out.set(day, []);
          matchedDayPart = true;
        }
      }
      continue;
    }
    const dm = part.match(/^([a-záéíóúñ\s]+?)\s*:\s*(.+)$/i);
    if (!dm) continue;
    const dayToken = norm(dm[1]).trim();
    const day = DAY_TOKEN[dayToken];
    if (day === undefined) continue;
    const segs = dm[2].split(/\by\b/i).filter((x) => x.trim().length > 0);
    const shifts: DayShift[] = [];
    for (const seg of segs) {
      const m = seg.match(RANGE_RE);
      if (!m) continue;
      const open = toMinutes(m[1], m[2], m[3]);
      const close = toMinutes(m[4], m[5], m[6]);
      if (open === null || close === null) continue;
      shifts.push({ open, close });
      if (shifts.length === 2) break;
    }
    if (shifts.length === 0) continue;
    matchedDayPart = true;
    out.set(day, shifts);
  }
  // Legacy sin prefijo de día ("9-18"): aplica a toda la semana.
  if (!matchedDayPart) {
    const m = s.match(RANGE_RE);
    if (m) {
      const open = toMinutes(m[1], m[2], m[3]);
      const close = toMinutes(m[4], m[5], m[6]);
      if (open !== null && close !== null) {
        for (let d = 0; d < 7; d++) out.set(d, [{ open, close }]);
      }
    }
  }
  return out;
}

/** Horario de reparto efectivo: propio, o el del local si es null/vacío. */
export function effectiveDeliveryHours(v: Pick<VendorSchedule, "hours" | "delivery_hours">): string | null {
  const own = (v.delivery_hours || "").trim();
  if (own) return own;
  const base = (v.hours || "").trim();
  return base || null;
}

export function usesStoreHours(v: Pick<VendorSchedule, "hours" | "delivery_hours">): boolean {
  return !(v.delivery_hours || "").trim();
}

export function normalizePrepMin(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return DELIVERY_DEFAULT_PREP_MIN;
  if (n === 0) return 0;
  return Math.min(240, Math.max(15, Math.round(n)));
}

function fmt(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

type DayCursor = { iso: string; weekday: number; y: number; m: number; d: number };

function tzParts(timeZone: string, at: Date): { weekday: number; minutes: number; y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const wd = get("weekday");
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: map[wd] ?? 0,
    minutes: (parseInt(get("hour"), 10) % 24) * 60 + parseInt(get("minute"), 10),
    y: parseInt(get("year"), 10),
    m: parseInt(get("month"), 10),
    d: parseInt(get("day"), 10),
  };
}

function addDaysISO(y: number, m: number, d: number, add: number): DayCursor {
  const dt = new Date(Date.UTC(y, m - 1, d + add));
  const yy = dt.getUTCFullYear();
  const mm = dt.getUTCMonth() + 1;
  const dd = dt.getUTCDate();
  return { iso: `${yy}-${pad(mm)}-${pad(dd)}`, weekday: dt.getUTCDay(), y: yy, m: mm, d: dd };
}

function shiftOpenNow(shifts: DayShift[], minutes: number): boolean {
  return shifts.some(({ open, close }) =>
    close > open ? minutes >= open && minutes < close : minutes >= open || minutes < close
  );
}

// ---------------------------------------------------------------------------
// Días especiales (extender hoy / agregar o extender mañana/+7)
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

function hhmmToMinutes(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(HHMM_RE);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 24 || mm < 0 || mm > 59) return null;
  if (h === 24 && mm !== 0) return null;
  return h * 60 + mm;
}

function weekdayOfISO(iso: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.getDay();
}

/**
 * Normaliza `delivery_extra_days` (jsonb crudo de la DB): solo entradas
 * bien formadas, sin overnight (close > open), fechas no pasadas.
 * open/close en minutos (null = no especificado).
 */
export function parseExtraDays(
  raw: unknown,
  opts?: { at?: Date; timeZone?: string }
): Map<string, { open: number | null; close: number | null }> {
  const out = new Map<string, { open: number | null; close: number | null }>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const tz = opts?.timeZone || DELIVERY_TZ;
  const at = opts?.at || new Date();
  const now = tzParts(tz, at);
  const todayISO = `${now.y}-${pad(now.m)}-${pad(now.d)}`;
  for (const [iso, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!ISO_DATE_RE.test(iso) || iso < todayISO) continue;
    if (!val || typeof val !== "object" || Array.isArray(val)) continue;
    const rec = val as Record<string, unknown>;
    const open = hhmmToMinutes(rec.open);
    const close = hhmmToMinutes(rec.close);
    if (open === null && close === null) continue;
    if (open !== null && close !== null && close <= open) continue;
    out.set(iso, { open, close });
    if (out.size >= DELIVERY_EXTRA_MAX_ENTRIES) break;
  }
  return out;
}

/**
 * Franjas efectivas de un día (ISO): el extra manda sobre el horario
 * semanal. {open,close} reemplaza la franja; solo {close} extiende la
 * última (si el día tiene horario); {open} solo se ignora.
 * Fusión por fecha exacta: un extra de hoy+7 no filtra al día de hoy.
 */
function shiftsForISO(
  iso: string,
  weekday: number,
  weekly: Map<number, DayShift[]>,
  extras: Map<string, { open: number | null; close: number | null }>
): DayShift[] {
  const base = weekly.get(weekday) || [];
  const ex = extras.get(iso);
  if (!ex) return base;
  if (ex.open !== null && ex.close !== null) return [{ open: ex.open, close: ex.close }];
  if (ex.close !== null && base.length > 0) {
    return [...base.slice(0, -1), { ...base[base.length - 1], close: ex.close }];
  }
  return base;
}

/** ¿La pausa está vigente? (vencida = se ignora, evaluación lazy sin cron). */
export function isDeliveryPaused(
  v: Pick<VendorSchedule, "delivery_override" | "delivery_paused_until">,
  opts?: { at?: Date }
): boolean {
  if (v.delivery_override !== false) return false;
  const until = (v.delivery_paused_until || "").trim();
  if (!until) return true; // hasta reanudar a mano
  const end = new Date(until).getTime();
  if (Number.isNaN(end)) return true;
  const now = (opts?.at || new Date()).getTime();
  return end > now;
}

/** Mensaje amable del motivo para el cliente, o null (sin mensaje). */
export function deliveryPauseClientMessage(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return DELIVERY_PAUSE_REASONS[reason]?.clientMsg ?? null;
}

/**
 * Abierto/cerrado del REPARTO (no del local). Precedencia:
 * pausa vigente → false · forzar abierto → true · `open_override` → como
 * `isStoreOpen` · si no, horario (+ días especiales). `null` = sin horario
 * interpretable (el caller oculta el badge y no ofrece turnos).
 */
export function isDeliveryOpen(
  v: VendorSchedule,
  opts?: { at?: Date; timeZone?: string }
): boolean | null {
  if (isDeliveryPaused(v, opts)) return false;
  if (v.delivery_override === true) return true;
  if (v.open_override === true) return true;
  if (v.open_override === false) return false;
  const hours = effectiveDeliveryHours(v);
  if (!hours) return null;
  const weekly = parseDeliveryShifts(hours);
  if (weekly.size === 0) return null;
  const tz = opts?.timeZone || DELIVERY_TZ;
  const at = opts?.at || new Date();
  const now = tzParts(tz, at);
  const iso = `${now.y}-${pad(now.m)}-${pad(now.d)}`;
  const extras = parseExtraDays(v.delivery_extra_days ?? null, opts);
  const today = shiftsForISO(iso, now.weekday, weekly, extras);
  if (today.length === 0) return false;
  return shiftOpenNow(today, now.minutes);
}

/** Extras vigentes con label ("hoy"/"mañana"/"lun 5/10") para la UI del panel. */export function listActiveExtras(
  v: Pick<VendorSchedule, "delivery_extra_days">,
  opts?: { at?: Date; timeZone?: string }
): { iso: string; open: string | null; close: string | null; label: string; isToday: boolean; isTomorrow: boolean }[] {
  const tz = opts?.timeZone || DELIVERY_TZ;
  const at = opts?.at || new Date();
  const now = tzParts(tz, at);
  const todayISO = `${now.y}-${pad(now.m)}-${pad(now.d)}`;
  const tom = addDaysISO(now.y, now.m, now.d, 1);
  const extras = parseExtraDays(v.delivery_extra_days ?? null, opts);
  const out: { iso: string; open: string | null; close: string | null; label: string; isToday: boolean; isTomorrow: boolean }[] = [];
  for (const [iso, ex] of extras) {
    const wd = weekdayOfISO(iso);
    const isToday = iso === todayISO;
    const isTomorrow = iso === tom.iso;
    const dayTxt = isToday ? "hoy" : isTomorrow ? "mañana" : wd === null ? iso.slice(5) : `${WEEKDAY_SHORT[wd]} ${iso.slice(8)}/${iso.slice(5, 7)}`;
    const range = ex.open !== null && ex.close !== null
      ? `${fmt(ex.open)}–${fmt(ex.close)}`
      : ex.close !== null
        ? `hasta las ${fmt(ex.close)}`
        : `desde las ${fmt(ex.open ?? 0)}`;
    out.push({
      iso,
      open: ex.open !== null ? fmt(ex.open) : null,
      close: ex.close !== null ? fmt(ex.close) : null,
      label: `${dayTxt} ${range}`,
      isToday,
      isTomorrow,
    });
  }
  return out.sort((a, b) => (a.iso < b.iso ? -1 : 1));
}

/**
 * Próximos `count` turnos de reparto (default 3): hoy lo que queda + días
 * siguientes con horario. Misma firma TZ que `isOpenNowInTz` (el VPS corre
 * en UTC; sin esto los turnos saldrían 3hs corridos).
 */
export function nextDeliverySlots(
  v: VendorSchedule,
  opts?: { at?: Date; timeZone?: string; count?: number }
): DeliverySlot[] {
  const hours = effectiveDeliveryHours(v);
  if (!hours) return [];
  const weekly = parseDeliveryShifts(hours);
  if (weekly.size === 0) return [];
  const count = Math.min(6, Math.max(1, opts?.count ?? DELIVERY_SLOTS_OFFERED));
  const tz = opts?.timeZone || DELIVERY_TZ;
  const at = opts?.at || new Date();
  const now = tzParts(tz, at);
  const extras = parseExtraDays(v.delivery_extra_days ?? null, opts);
  const out: DeliverySlot[] = [];
  for (let add = 0; add < 8 && out.length < count; add++) {
    const day = addDaysISO(now.y, now.m, now.d, add);
    const dayShifts = shiftsForISO(day.iso, day.weekday, weekly, extras);
    for (const s of dayShifts) {
      if (out.length >= count) break;
      // Hoy: solo franjas que aún no terminaron (con 5 min de changüí para
      // el cierre: si cierra 20:00 y son 20:02, ya no se ofrece). Las que
      // cruzan medianoche (20:00-02:00) siempre se muestran.
      if (add === 0 && s.close > s.open && now.minutes >= s.close + 5) continue;
      const range = `${fmt(s.open)}–${fmt(s.close)}`;
      const id = `${day.iso}|${fmt(s.open)}-${fmt(s.close)}`;
      const isToday = add === 0;
      const isTomorrow = add === 1;
      const label = isToday
        ? `hoy ${range}`
        : isTomorrow
          ? `mañana ${range}`
          : `${WEEKDAY_SHORT[day.weekday]} ${range}`;
      out.push({ id, dateISO: day.iso, label, range, isToday, isTomorrow });
    }
  }
  return out;
}

/** ¿El `delivery_window` que mandó el cliente es uno de los ofrecidos? */
export function isValidDeliveryWindow(windowId: string | null | undefined, slots: DeliverySlot[]): boolean {
  if (!windowId) return false;
  return slots.some((s) => s.id === windowId);
}

/** "2026-10-03|09:00-13:00" → "mañana 09:00–13:00" (para ticket/WhatsApp). */
export function deliveryWindowLabel(windowId: string | null | undefined, slots?: DeliverySlot[]): string | null {
  if (!windowId) return null;
  const hit = (slots || []).find((s) => s.id === windowId);
  if (hit) return hit.label;
  return formatDeliveryWindow(String(windowId));
}

/**
 * "2026-10-03|09:00-13:00" → "mañana 09:00–13:00" (relativo al día actual,
 * sin necesidad de slots). Si no matchea, devuelve el texto recortado.
 */
export function formatDeliveryWindow(windowId: string | null | undefined): string | null {
  if (!windowId) return null;
  const m = String(windowId).match(/^(\d{4})-(\d{2})-(\d{2})\|(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!m) return String(windowId).slice(0, 60);
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((dt.getTime() - today.getTime()) / 86400000);
  const day =
    diff === 0
      ? "hoy"
      : diff === 1
        ? "mañana"
        : dt.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "numeric" });
  return `${day} ${m[4]}–${m[5]}`;
}

/**
 * Horario semanal de una fecha ("09:00–18:00 · 17:00–22:00") o null si el
 * día está cerrado. Sin extras: para pre-llenar el editor de día especial.
 */
export function scheduleTextForISO(
  v: Pick<VendorSchedule, "hours" | "delivery_hours">,
  iso: string
): string | null {
  const wd = weekdayOfISO(iso);
  if (wd === null) return null;
  const hours = effectiveDeliveryHours(v);
  if (!hours) return null;
  const shifts = parseDeliveryShifts(hours).get(wd) || [];
  if (shifts.length === 0) return null;
  return shifts.map((s) => `${fmt(s.open)}–${fmt(s.close)}`).join(" · ");
}

/** Minutos de una franja "HH:MM" del editor (para pre-llenar inputs). */
export function shiftMinutesForISO(
  v: Pick<VendorSchedule, "hours" | "delivery_hours">,
  iso: string
): { open: string; close: string } | null {
  const wd = weekdayOfISO(iso);
  if (wd === null) return null;
  const hours = effectiveDeliveryHours(v);
  if (!hours) return null;
  const shifts = parseDeliveryShifts(hours).get(wd) || [];
  if (shifts.length === 0) return null;
  const last = shifts[shifts.length - 1];
  return { open: fmt(shifts[0].open), close: fmt(last.close) };
}

/** Extra que cubre este momento (para la pill del header), o null. */
export function extraCoveringNow(
  v: Pick<VendorSchedule, "hours" | "delivery_hours" | "delivery_extra_days">,
  opts?: { at?: Date; timeZone?: string }
): { iso: string; close: string } | null {
  const tz = opts?.timeZone || DELIVERY_TZ;
  const at = opts?.at || new Date();
  const now = tzParts(tz, at);
  const iso = `${now.y}-${pad(now.m)}-${pad(now.d)}`;
  const hours = effectiveDeliveryHours(v);
  if (!hours) return null;
  const weekly = parseDeliveryShifts(hours);
  const extras = parseExtraDays(v.delivery_extra_days ?? null, opts);
  const ex = extras.get(iso);
  if (!ex || ex.open === null || ex.close === null) return null;
  if (now.minutes < ex.open || now.minutes >= ex.close) return null;
  const base = weekly.get(now.weekday) || [];
  const sameAsSchedule = base.length === 1 && base[0].open === ex.open && base[0].close === ex.close;
  if (sameAsSchedule) return null; // no es "extra", es el horario normal
  return { iso, close: fmt(ex.close) };
}
