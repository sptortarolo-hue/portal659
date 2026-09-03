"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type DayConfig = {
  open: string; // "09:00" (24h)
  close: string; // "18:00"
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
  return DAYS.map(() => ({ open: "09:00", close: "18:00", closed: true }));
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

/** Parsea el texto "open-hours" a config por día. Tolera formatos legacy. */
function parseHours(text: string | null | undefined): DayConfig[] {
  const cfg = defaultConfig();
  if (!text) return cfg;

  const parts = text.toLowerCase().split(/[,;]\s*/);
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.includes("cerrado") || part === "n/a") continue;

    // rango horario: "9:00-18:00", "9 am-6 pm", "9 a 18"
    const range = part.match(
      /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:[-–]|\ba\b)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i
    );
    if (!range) continue;

    const open = to24(range[1], range[2], range[3]?.toLowerCase());
    const close = to24(range[4], range[5], range[6]?.toLowerCase());

    for (const idx of daysInPart(part)) {
      cfg[idx] = { open, close, closed: false };
    }
  }
  return cfg;
}

/** Serializa a texto estable, compatible con open-hours.isOpenNow: "lun: 09:00-18:00, ..." */
function serialize(cfg: DayConfig[]): string {
  const parts: string[] = [];
  cfg.forEach((d, i) => {
    if (d.closed) return;
    parts.push(`${ORDER[i]}: ${d.open}-${d.close}`);
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

  function update(idx: number, patch: Partial<DayConfig>) {
    // Los updaters de setState deben ser puros: notificar al padre por fuera.
    const next = cfg.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setCfg(next);
    onChange(serialize(next));
  }

  return (
    <div className="space-y-2">
      {cfg.map((day, idx) => (
        <div key={ORDER[idx]} className="flex items-center gap-2">
          <div className="w-9 sm:w-20 flex-shrink-0 text-sm">
            <span className="sm:hidden">{DAYS[idx].label.slice(0, 3)}</span>
            <span className="hidden sm:inline">{DAYS[idx].label}</span>
          </div>
          <div className="flex flex-1 items-center gap-1.5 min-w-0">
            <Input
              type="time"
              className="h-9 min-w-0 flex-1 px-1.5 sm:px-3 text-xs sm:text-sm"
              value={day.open}
              disabled={day.closed}
              onChange={(e) => update(idx, { open: e.target.value })}
            />
            <span className="text-muted-foreground flex-shrink-0">a</span>
            <Input
              type="time"
              className="h-9 min-w-0 flex-1 px-1.5 sm:px-3 text-xs sm:text-sm"
              value={day.close}
              disabled={day.closed}
              onChange={(e) => update(idx, { close: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Label className="hidden sm:inline text-xs text-muted-foreground">Cerrado</Label>
            <Switch checked={day.closed} onCheckedChange={(v) => update(idx, { closed: v })} />
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground mt-1">
        Horario generado: <span className="font-medium">{value || "Sin horario"}</span>
      </p>
    </div>
  );
}
