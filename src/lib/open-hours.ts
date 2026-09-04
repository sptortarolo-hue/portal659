// Días (normalizados, sin acentos) → número de día JS (0=domingo..6=sábado)
const DAY_MAP: Record<string, number> = {
  dom: 0, lun: 1, mar: 2, mie: 3, jue: 4, vie: 5, sab: 6,
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // diacríticos combinantes U+0300–U+036F
}

function parseTime(t: string): { h: number; m: number } | null {
  const match = t.trim().match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i);
  if (!match) return null;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2] || "0", 10);
  const suffix = match[3]?.toLowerCase();
  if (suffix === "pm" && h < 12) h += 12;
  if (suffix === "am" && h === 12) h = 0;
  return { h, m };
}

function toMinutes(t: string): number | null {
  const parsed = parseTime(t);
  if (!parsed) return null;
  return parsed.h * 60 + parsed.m;
}

/**
 * Días cubiertos por un token de parte ("lun", "vie", "lun a vie", "sabado").
 * Devuelve números de día (0-6). Dos días con "a" → rango inclusivo.
 */
function daysForToken(token: string): number[] {
  const t = norm(token).trim();
  const rangeParts = t.split(/\s+a\s+/);
  if (rangeParts.length === 2) {
    const a = DAY_MAP[rangeParts[0].trim()];
    const b = DAY_MAP[rangeParts[1].trim()];
    if (a !== undefined && b !== undefined) {
      const out: number[] = [];
      let i = a;
      // recorrido circular (soporta "vie a dom")
      for (;;) {
        out.push(i);
        if (i === b) break;
        i = (i + 1) % 7;
      }
      return out;
    }
  }
  // múltiples días sueltos ("sabado domingo")
  const found: number[] = [];
  for (const [tokenNorm, dayNum] of Object.entries(DAY_MAP)) {
    if (new RegExp(`\\b${tokenNorm}\\b`).test(t) && !found.includes(dayNum)) found.push(dayNum);
  }
  return found;
}

export function isOpenNow(hoursStr: string | null | undefined): boolean | null {
  const now = new Date();
  return isOpenWithClock(hoursStr, now.getDay(), now.getHours() * 60 + now.getMinutes());
}

export function openStatusText(isOpen: boolean | null): string {
  if (isOpen === true) return "Abierto ahora";
  if (isOpen === false) return "Cerrado";
  return "Horarios no disponibles";
}

export const TZ_AR = "America/Argentina/Buenos_Aires";

/**
 * Abierto/cerrado con timezone explícito. El server del VPS corre en UTC; sin
 * esto el check del lado servidor (/api/orders, micrositio SSR) usaba hora UTC
 * y fallaba 3hs corridas. `null` si no hay horario interpretable.
 * `at` es para tests (inyecciones de hora) — en producción nunca se pasa.
 */
export function isOpenNowInTz(
  hoursStr: string | null | undefined,
  timeZone: string,
  at?: Date
): boolean | null {
  if (!hoursStr) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at ?? new Date());
  const wd = parts.find((p) => p.type === "weekday")?.value || "";
  const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10) % 24;
  const m = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return isOpenWithClock(hoursStr, dayMap[wd] ?? 0, h * 60 + m);
}

/** Override manual gana; si es null/undefined se resuelve por horarios. */
export function isStoreOpen(
  vendor: { hours?: string | null; open_override?: boolean | null },
  timeZone: string = TZ_AR
): boolean | null {
  if (vendor.open_override === true) return true;
  if (vendor.open_override === false) return false;
  return isOpenNowInTz(vendor.hours ?? null, timeZone);
}

function isOpenWithClock(hoursStr: string | null | undefined, currentDay: number, currentMinutes: number): boolean | null {
  if (!hoursStr) return null;
  const s = hoursStr.toLowerCase().trim();
  if (s.includes("24") || s.includes("todo el día") || s.includes("siempre")) return true;
  if (s === "cerrado" || s === "n/a") return false;

  // Partes con día explícito: "lun: 09:00-18:00" (formato del editor),
  // "lun: 09:00-13:00 y 17:00-22:00" (2 franjas horarias del día),
  // "lun a vie 9-18", "lunes 9 am - 6 pm", etc.
  const dayParts = s.split(/[,;]\s*/);
  let sawDayPart = false;

  for (const part of dayParts) {
    if (!part) continue;
    // Marcamos "hay config por días" aunque el día esté cerrado ("dom: cerrado"),
    // para distinguir "hoy cerrado explícito" (false) de "sin horarios" (null).
    if (part.includes("cerrado") || part === "n/a") {
      if (daysForToken(part).length > 0) sawDayPart = true;
      continue;
    }
    const m = part.match(
      /([a-záéíóúñ\s]+?)\s*:?\s*(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)\s*(?:[-–]|\ba\b)\s*(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)/i
    );
    if (!m) continue;
    const days = daysForToken(m[1]);
    if (days.length === 0) continue;
    sawDayPart = true;
    if (!days.includes(currentDay)) continue;

    const checks: [number, number][] = [];
    const openMin = toMinutes(m[2]);
    const closeMin = toMinutes(m[3]);
    if (openMin !== null && closeMin !== null) checks.push([openMin, closeMin]);

    // Segundo rango opcional: "... y 17:00-22:00" (jornada cortada)
    const m2 = part.match(
      /\by\s+(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)\s*(?:[-–]|\ba\b)\s*(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)/i
    );
    if (m2) {
      const open2 = toMinutes(m2[1]);
      const close2 = toMinutes(m2[2]);
      if (open2 !== null && close2 !== null) checks.push([open2, close2]);
    }

    for (const [open, close] of checks) {
      if (close > open) {
        if (currentMinutes >= open && currentMinutes < close) return true;
      } else {
        if (currentMinutes >= open || currentMinutes < close) return true;
      }
    }
  }

  if (sawDayPart) return false;

  const simpleRange = s.match(/(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)\s*(?:[-–]|\ba\b)\s*(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)/i);
  if (simpleRange) {
    const openMin = toMinutes(simpleRange[1]);
    const closeMin = toMinutes(simpleRange[2]);
    if (openMin !== null && closeMin !== null) {
      if (closeMin > openMin) {
        if (currentMinutes >= openMin && currentMinutes < closeMin) return true;
      } else {
        if (currentMinutes >= openMin || currentMinutes < closeMin) return true;
      }
    }
    return false;
  }

  return null;
}

