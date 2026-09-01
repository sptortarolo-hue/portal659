"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

type DayConfig = {
  open: string; // "12:00"
  close: string; // "22:00"
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

function fmt(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hh = parseInt(h, 10);
  return `${hh}:${m || "00"}`;
}

function hourLabel(t: string): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hh = parseInt(h, 10);
  const mm = m ? parseInt(m, 10) : 0;
  const period = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${String(mm).padStart(2, "0")} ${period}` : `${h12} ${period}`;
}

/** Parsea el texto actual (formato open-hours) a config por día. */
function parseHours(text: string | null | undefined): DayConfig[] {
  const cfg = defaultConfig();
  if (!text) return cfg;

  const s = text.toLowerCase().trim();
  // marcar abiertos: rango simple sin día (aplica a todos) o por día
  const hasGlobal = /^\d{1,2}/.test(s.replace(/^.*?(\d)/, "$1"));
  const globalRange = s.match(/(\d{1,2}):?(\d{0,2})\s*[-–]\s*(\d{1,2}):?(\d{0,2})/i);

  // dividir en partes por coma
  const parts = s.split(/[,;]\s*/);
  for (const part of parts) {
    if (!part) continue;
    if (part.includes("cerrado") || part.includes("no.") || part === "n/a") continue;

    const range = part.match(/(\d{1,2}):?(\d{0,2})\s*[-–a]\s*(\d{1,2}):?(\d{0,2})/i);
    if (!range) continue;
    const open = fmt(`${range[1]}:${range[2] || "00"}`);
    const close = fmt(`${range[3]}:${range[4] || "00"}`);

    // detectar días en la parte
    const dayKeys = ORDER.filter((dk) => part.includes(dk));
    const dayName = part.match(/lunes|martes|mi[ée]rcoles|jueves|viernes|s[aá]bado|domingo|(lun|mar|mi[eé]|jue|vie|s[aá]b|dom)/i);
    let target: string[] = [];
    if (dayName) {
      const full = dayName[0].toLowerCase();
      const found = ORDER.find((dk) => dk === full || (full.length > 3 ? dk.includes(full.slice(0, 3)) : full === dk));
      if (found) target.push(found);
    } else if (dayKeys.length) {
      target = dayKeys;
    } else if (globalRange) {
      target = ORDER;
    } else {
      target = ORDER;
    }
    for (const dk of target) {
      const idx = ORDER.indexOf(dk);
      if (idx >= 0) {
        cfg[idx] = { open, close, closed: false };
      }
    }
  }
  return cfg;
}

/** Serializa la config a texto compatible con open-hours.ts. */
function serialize(cfg: DayConfig[]): string {
  const segs: { start: number; end: number; open: string; close: string }[] = [];
  let i = 0;
  while (i < 7) {
    if (cfg[i].closed) {
      i++;
      continue;
    }
    const open = cfg[i].open;
    const close = cfg[i].close;
    let j = i;
    while (j + 1 < 7 && !cfg[j + 1].closed && cfg[j + 1].open === open && cfg[j + 1].close === close) j++;
    segs.push({ start: i, end: j, open, close });
    i = j + 1;
  }
  if (segs.length === 0) return "";
  return segs
    .map((seg) => {
      const startLabel = ORDER[seg.start];
      const endLabel = ORDER[seg.end];
      const days = seg.start === seg.end ? startLabel : `${startLabel} a ${endLabel}`;
      return `${days} ${hourLabel(seg.open)}-${hourLabel(seg.close)}`;
    })
    .join(", ");
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
    setCfg(parseHours(value));
  }, [value]);

  function update(idx: number, patch: Partial<DayConfig>) {
    const next = cfg.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    setCfg(next);
    onChange(serialize(next));
  }

  return (
    <div className="space-y-2">
      {cfg.map((day, idx) => (
        <div key={ORDER[idx]} className="flex items-center gap-2">
          <div className="w-20 text-sm">{DAYS[idx].label}</div>
          <div className="flex items-center gap-2">
            <Input
              type="time"
              className="h-9 w-28"
              value={day.open}
              disabled={day.closed}
              onChange={(e) => update(idx, { open: e.target.value })}
            />
            <span className="text-muted-foreground">a</span>
            <Input
              type="time"
              className="h-9 w-28"
              value={day.close}
              disabled={day.closed}
              onChange={(e) => update(idx, { close: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <Label className="text-xs text-muted-foreground">Cerrado</Label>
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