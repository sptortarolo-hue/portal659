"use client";

import { useState } from "react";
import { parseWeeklyHours, todayWeekDay } from "@/lib/open-hours";

/**
 * Horarios de atención, un día por línea, con el día actual resaltado.
 *
 * - Vista plegada: solo el día de hoy + pastillas de "Ver semana".
 * - Vista expandida: los 7 días (lunes→domingo), uno por renglón; el día de
 *   hoy va resaltado con punto + "Hoy".
 *
 * Fallback: si el string no viene en el formato del editor (legacy), se
 * muestra crudo, igual que antes.
 */
export function WeeklyHours({
  hours,
  openNow,
}: {
  hours: string;
  /** Estado actual de abierto/cerrado (para el indicador visual del día de hoy). */
  openNow?: boolean | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = parseWeeklyHours(hours);
  const todayIdx = todayWeekDay();
  const today = rows?.find((r) => r.dayIdx === todayIdx);

  // Fallback: formato legacy o libre → pill con el string crudo (como antes).
  if (!rows || !today) {
    return (
      <div className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground mt-4 max-w-full">
        🕐 {hours}
      </div>
    );
  }

  const dot = openNow === true
    ? "🟢"
    : openNow === false
      ? "🔴"
      : "🕐";

  return (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-card/60 px-4 py-3 mt-3">
      {/* Día de hoy (siempre visible) + toggle semana */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="min-w-0">
          <span className="text-sm font-semibold">
            {dot} Hoy
          </span>
          <span className="text-sm text-muted-foreground ml-1.5">
            {today.label} · <span className="text-foreground font-medium">{today.text}</span>
          </span>
        </div>
        <span className="text-xs text-primary font-medium flex-shrink-0 hover:underline">
          {expanded ? "Ver menos ▲" : "Ver semana ▼"}
        </span>
      </button>

      {/* Semana completa */}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-border space-y-1">
          {rows.map((r) => {
            const isToday = r.dayIdx === todayIdx;
            return (
              <div
                key={r.dayIdx}
                className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm ${
                  isToday ? "bg-primary/10 font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="shrink-0">{r.label}</span>
                <span className={`tabular-nums text-right ${r.closed ? "text-muted-foreground/70" : ""}`}>
                  {isToday && (
                    <span className="mr-1.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold px-1.5 py-0.5">
                      {dot} Hoy
                    </span>
                  )}
                  {r.text}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
