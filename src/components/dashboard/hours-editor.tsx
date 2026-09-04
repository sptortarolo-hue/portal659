"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

// Hasta 2 franjas por día (horario cortado: mañana + tarde/noche).
type DayShift = { open: string; close: string }; // "09:00" / "13:00" (24h)
type DayConfig = {
  shifts: DayShift[]; // 1 o 2
  closed: boolean;
};

const DAYS: { key: string; label: string }[] = [
  { key: "lun", label: "Lunes" },
  { key: "mar", label: "Martes" },
  { key: "mié", label: "Miércoles" },
  { key: "jue", label: "Jueves" },
  { key: "vie", label: "Viernes" },
  { key: "sáb", label: "Sábado" },
  { key: "dom", label: "Domingo" },
];

const ORDER: string[] = DAYS.map((d) => d.key);

function defaultConfig(): DayConfig[] {
  return DAYS.map(() => ({ shifts: [{ open: "09:00", close: "18:00" }], closed: true }));
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// ^ La clase [̀-ͯ] son los diacríticos combinantes U+0300–U+036F.

// Tokens de día aceptados (normalizados, sin acentos) → índice en ORDER (0=lun..6=dom)
const DAY_INDEX: Record<string, number> = {
  lun: 0, lunes: 0,
  mar: 1, martes: 1,
  mie: 2, miercoles: 2,
  jue: 3, jueves: 3,
  vie: 4, viernes: 4,
  sab: 5, sabado: 5,
  dom: 6, domingo: 6,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function to24(hStr: string, mStr: string | undefined, meridian?: string): string {
  let h = parseInt(hStr, 10);
  if (Number.isNaN(h)) h = 9;
  if (meridian === "pm" && h < 12) h += 12;
  if (meridian === "am" && h === 12) h = 0;
  return `${pad2(h)}:${pad2(parseInt(mStr || "0", 10) || 0)}`;
}

/**
 * Días mencionados en una parte de texto ("lun a vie", "sáb", sin días → todos).
 * Devuelve índices de ORDER. Dos días → rango inclusivo (lun a vie = lun..vie).
 */
function daysInPart(part: string): number[] {
  const t = norm(part);
  const found: number[] = [];
  for (const [token, idx] of Object.entries(DAY_INDEX)) {
    if (new RegExp(`\\b${token}\\b`).test(t) && !found.includes(idx)) found.push(idx);
  }
  found.sort((a, b) => a - b);
  if (found.length === 2) {
    const out: number[] = [];
    for (let i = found[0]; i <= found[1]; i++) out.push(i);
    return out;
  }
  if (found.length > 0) return found;
  return [0, 1, 2, 3, 4, 5, 6]; // sin día explícito: aplica a todos
}

const RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:[-–]|\ba\b)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

/** Parsea el texto "open-hours" a config por día. Tolera legacy y 2 franjas ("y"). */
function parseHours(text: string | null | undefined): DayConfig[] {
  const cfg = defaultConfig();
  if (!text) return cfg;

  const parts = text.toLowerCase().split(/[,;]\s*/);
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.includes("cerrado") || part === "n/a") continue;

    // Segmentos separados por "y": jornada cortada (09-13 y 17-22).
    const segments = part.split(/\by\b/i).filter((s) => s.trim().length > 0);
    const shifts: DayShift[] = [];
    for (const seg of segments) {
      const range = seg.match(RANGE_RE);
      if (!range) continue;
      const open = to24(range[1], range[2], range[3]?.toLowerCase());
      const close = to24(range[4], range[5], range[6]?.toLowerCase());
      shifts.push({ open, close });
      if (shifts.length === 2) break;
    }
    if (shifts.length === 0) continue;

    for (const idx of daysInPart(part)) {
      cfg[idx] = { shifts: shifts.map((s) => ({ ...s })), closed: false };
    }
  }
  return cfg;
}

/** Serializa a texto estable, compatible con open-hours.isOpenNow. */
function serialize(cfg: DayConfig[]): string {
  const parts: string[] = [];
  cfg.forEach((d, i) => {
    if (d.closed) return;
    const segs = d.shifts.map((s) => `${s.open}-${s.close}`).join(" y ");
    parts.push(`${ORDER[i]}: ${segs}`);
  });
  return parts.join(", ");
}

export function HoursEditor({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (text: string) => void;
}) {
  const [cfg, setCfg] = useState<DayConfig[]>(() => parseHours(value));

  // Re-sincronizar solo cuando el valor externo realmente cambió
  // (evita el loop serialize→parse que corrompía los días en cada edición).
  useEffect(() => {
    setCfg((prev) => {
      const next = parseHours(value);
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [value]);

  function commit(next: DayConfig[]) {
    setCfg(next);
    onChange(serialize(next));
  }

  function updateShift(idx: number, shiftIdx: number, patch: Partial<DayShift>) {
    const next = cfg.map((c, i) =>
      i !== idx
        ? c
        : { ...c, shifts: c.shifts.map((s, j) => (j === shiftIdx ? { ...s, ...patch } : s)) }
    );
    commit(next);
  }

  function toggleClosed(idx: number, closed: boolean) {
    commit(cfg.map((c, i) => (i === idx ? { ...c, closed } : c)));
  }

  function addShift(idx: number) {
    commit(cfg.map((c, i) => (i === idx ? { ...c, shifts: [...c.shifts, { open: "17:00", close: "22:00" }] } : c)));
  }

  function removeShift(idx: number) {
    commit(cfg.map((c, i) => (i === idx ? { ...c, shifts: c.shifts.slice(0, 1) } : c)));
  }

  function copyToAll(idx: number) {
    const src = cfg[idx];
    commit(cfg.map(() => ({ shifts: src.shifts.map((s) => ({ ...s })), closed: src.closed })));
  }

  return (
    <div className="space-y-2">
      {cfg.map((day, idx) => (
        <div key={ORDER[idx]} className="rounded-xl border border-border bg-card p-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-16 sm:w-20 flex-shrink-0 text-sm font-medium truncate">{DAYS[idx].label}</span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <Switch checked={!day.closed} onCheckedChange={(v) => toggleClosed(idx, !v)} />
                <Label className="text-xs text-muted-foreground">{day.closed ? "Cerrado" : "Abierto"}</Label>
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {!day.closed && day.shifts.length < 2 && (
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => addShift(idx)} title="Agregar segunda franja (horario cortado)">
                  + Tarde
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => copyToAll(idx)} title="Copiar este día a toda la semana">
                Copiar a todos
              </Button>
            </div>
          </div>

          {!day.closed && day.shifts.map((shift, sIdx) => (
            <div key={sIdx} className="flex items-center gap-1.5 min-w-0 pl-1">
              {day.shifts.length === 2 && (
                <span className="text-[10px] text-muted-foreground w-14 flex-shrink-0">{sIdx === 0 ? "Mañana" : "Tarde"}</span>
              )}
              <Input
                type="time"
                className="h-9 min-w-0 flex-1 px-1.5 sm:px-3 text-xs sm:text-sm"
                value={shift.open}
                onChange={(e) => updateShift(idx, sIdx, { open: e.target.value })}
              />
              <span className="text-muted-foreground flex-shrink-0">a</span>
              <Input
                type="time"
                className="h-9 min-w-0 flex-1 px-1.5 sm:px-3 text-xs sm:text-sm"
                value={shift.close}
                onChange={(e) => updateShift(idx, sIdx, { close: e.target.value })}
              />
              {day.shifts.length === 2 && (
                <button
                  type="button"
                  onClick={() => removeShift(idx)}
                  className="h-7 w-7 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 flex items-center justify-center flex-shrink-0"
                  aria-label="Quitar esta franja"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      <p className="text-xs text-muted-foreground mt-1">
        Horario generado: <span className="font-medium">{value || "Sin horario"}</span>
      </p>
    </div>
  );
}
