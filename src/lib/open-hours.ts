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
  if (!hoursStr) return null;
  const s = hoursStr.toLowerCase().trim();
  if (s.includes("24") || s.includes("todo el día") || s.includes("siempre")) return true;
  if (s === "cerrado" || s === "n/a") return false;

  const now = new Date();
  const currentDay = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Partes con día explícito: "lun: 09:00-18:00" (formato del editor),
  // "lun a vie 9-18", "lunes 9 am - 6 pm", etc.
  const dayParts = s.split(/[,;]\s*/);
  let sawDayPart = false;

  for (const part of dayParts) {
    if (!part || part.includes("cerrado") || part === "n/a") continue;
    const m = part.match(
      /([a-záéíóúñ\s]+?)\s*:?\s*(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)\s*(?:[-–]|\ba\b)\s*(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)/i
    );
    if (!m) continue;
    const days = daysForToken(m[1]);
    if (days.length === 0) continue;
    sawDayPart = true;
    if (!days.includes(currentDay)) continue;

    const openMin = toMinutes(m[2]);
    const closeMin = toMinutes(m[3]);
    if (openMin === null || closeMin === null) continue;
    if (closeMin > openMin) {
      if (currentMinutes >= openMin && currentMinutes < closeMin) return true;
    } else {
      if (currentMinutes >= openMin || currentMinutes < closeMin) return true;
    }
  }

  // Si el texto tiene partes por día y ninguna cubrió hoy → está cerrado.
  if (sawDayPart) return false;

  // Formato simple sin día: "9-18" aplica a todos los días.
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

export function openStatusText(isOpen: boolean | null): string {
  if (isOpen === true) return "Abierto ahora";
  if (isOpen === false) return "Cerrado";
  return "Horarios no disponibles";
}
