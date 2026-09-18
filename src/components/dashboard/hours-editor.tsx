"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { TimeSelect24 } from "@/components/ui/time-select-24";

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
const DAY_ABBR: Record<string, string> = { lun: "Lun", mar: "Mar", mié: "Mié", jue: "Jue", vie: "Vie", sáb: "Sáb", dom: "Dom" };

function defaultConfig(): DayConfig[] {
  return DAYS.map(() => ({ shifts: [{ open: "09:00", close: "18:00" }], closed: true }));
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

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
  return [0, 1, 2, 3, 4, 5, 6];
}

const RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:[-–]|\ba\b)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;

function parseHours(text: string | null | undefined): DayConfig[] {
  const cfg = defaultConfig();
  if (!text) return cfg;
  // "Abierto 24 hs": todos los días abiertos de 00:00 a 23:59 (roundtrip del toggle).
  if (/\b24\s*(hs|horas|\/7)\b/i.test(text) || /todo el d[ií]a/i.test(text)) {
    return DAYS.map(() => ({ shifts: [{ open: "00:00", close: "23:59" }], closed: false }));
  }

  const parts = text.toLowerCase().split(/[,;]\s*/);
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.includes("cerrado") || part === "n/a") continue;

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

function serialize(cfg: DayConfig[]): string {
  const parts: string[] = [];
  cfg.forEach((d, i) => {
    if (d.closed) return;
    const segs = d.shifts.map((s) => `${s.open}-${s.close}`).join(" y ");
    parts.push(`${ORDER[i]}: ${segs}`);
  });
  return parts.join(", ");
}

type ShiftFieldProps = {
  label: string | null;
  shift: DayShift;
  onOpen: (v: string) => void;
  onClose: (v: string) => void;
  onRemove?: () => void;
};

function ShiftField({ label, shift, onOpen, onClose, onRemove }: ShiftFieldProps) {
  return (
    <div className="flex items-center gap-1.5 w-full">
      {label && <span className="text-[10px] text-muted-foreground w-12 flex-shrink-0 text-right">{label}</span>}
      <TimeSelect24
        value={shift.open}
        onChange={onOpen}
        aria-label={label ? `${label} apertura` : "Apertura"}
      />
      <span className="text-muted-foreground flex-shrink-0 text-xs">a</span>
      <TimeSelect24
        value={shift.close}
        onChange={onClose}
        aria-label={label ? `${label} cierre` : "Cierre"}
      />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="h-7 w-7 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 flex items-center justify-center flex-shrink-0"
          aria-label="Quitar franja"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function HoursEditor({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (text: string) => void;
}) {
  const [cfg, setCfg] = useState<DayConfig[]>(() => parseHours(value));

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
    commit(
      cfg.map((c, i) =>
        i !== idx
          ? c
          : { ...c, shifts: c.shifts.map((s, j) => (j === shiftIdx ? { ...s, ...patch } : s)) }
      )
    );
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
        <div key={ORDER[idx]} className="rounded-xl border border-border bg-card p-3 space-y-2.5">
          {/* Línea 1: nombre + switch cerrado (mobile) / todo en una fila (desktop) */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="flex items-center justify-between sm:justify-start sm:gap-2">
              <span className="text-sm font-medium">
                <span className="sm:hidden">{DAY_ABBR[ORDER[idx]]}</span>
                <span className="hidden sm:inline">{DAYS[idx].label}</span>
              </span>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <Switch checked={!day.closed} onCheckedChange={(v) => toggleClosed(idx, !v)} />
                </div>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground hover:text-primary font-medium"
                  onClick={() => copyToAll(idx)}
                  title="Copiar a toda la semana"
                >
                  ⧉ Copiar
                </button>
              </div>
            </div>
            <span className={`text-[11px] sm:ml-auto ${day.closed ? "text-muted-foreground" : "text-primary font-medium"}`}>
              {day.closed ? "Cerrado" : "Abierto"}
            </span>
          </div>

          {/* Línea 2+: franjas de horario (solo si está abierto) */}
          {!day.closed && (
            <div className="space-y-2">
              {day.shifts.map((shift, sIdx) => (
                <ShiftField
                  key={sIdx}
                  label={day.shifts.length === 2 ? (sIdx === 0 ? "Mañana" : "Tarde") : null}
                  shift={shift}
                  onOpen={(v) => updateShift(idx, sIdx, { open: v })}
                  onClose={(v) => updateShift(idx, sIdx, { close: v })}
                  onRemove={day.shifts.length === 2 ? () => removeShift(idx) : undefined}
                />
              ))}
              {day.shifts.length < 2 && (
                <button
                  type="button"
                  className="text-[11px] text-primary font-medium"
                  onClick={() => addShift(idx)}
                >
                  + Agregar franja (tarde/noche)
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground mt-1">
        Horario generado: <span className="font-medium">{value || "Sin horario"}</span>
      </p>
    </div>
  );
}