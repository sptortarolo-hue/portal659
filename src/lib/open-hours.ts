const DAY_MAP: Record<string, number> = {
  dom: 0, lun: 1, mar: 2, mié: 3, jue: 4, vie: 5, sáb: 6,
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

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

export function isOpenNow(hoursStr: string | null | undefined): boolean | null {
  if (!hoursStr) return null;
  const s = hoursStr.toLowerCase().trim();
  if (s.includes("24") || s.includes("todo el día") || s.includes("siempre")) return true;
  if (s.includes("cerrado") || s.includes("no.") || s === "n/a") return false;

  const now = new Date();
  const currentDay = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const dayParts = s.split(/[,;]\s*/);
  for (const part of dayParts) {
    const rangeMatch = part.match(/(\w+)\s*[:\-a]\s*(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)\s*[-–a]\s*(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)/i);
    if (rangeMatch) {
      const dayKey = rangeMatch[1].toLowerCase().trim();
      const dayNum = DAY_MAP[dayKey];
      if (dayNum === undefined) continue;

      if (dayNum === currentDay) {
        const openMin = toMinutes(rangeMatch[2]);
        const closeMin = toMinutes(rangeMatch[3]);
        if (openMin !== null && closeMin !== null) {
          if (closeMin > openMin) {
            if (currentMinutes >= openMin && currentMinutes < closeMin) return true;
          } else {
            if (currentMinutes >= openMin || currentMinutes < closeMin) return true;
          }
        }
      }
    }
  }

  const simpleRange = s.match(/(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)\s*[-–a]\s*(\d{1,2}:?\d{0,2}(?:\s*(?:am|pm))?)/i);
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
  }

  return null;
}

export function openStatusText(isOpen: boolean | null): string {
  if (isOpen === true) return "Abierto ahora";
  if (isOpen === false) return "Cerrado";
  return "Horarios no disponibles";
}
