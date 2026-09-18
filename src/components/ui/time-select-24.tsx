"use client";

type TimeSelect24Props = {
  /** "HH:MM" 24hs. */
  value: string;
  onChange: (v: string) => void;
  "aria-label"?: string;
};

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
// Minutos de a 5: suficientes para horarios de atención y manejan mejor en móvil.
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

/**
 * Selector de hora y minuto SIEMPRE 24hs (los <input type="time"> nativos
 * pueden mostrar AM/PM según el locale del SO del dispositivo).
 */
export function TimeSelect24({ value, onChange, "aria-label": ariaLabel }: TimeSelect24Props) {
  const [h = "09", m = "00"] = (value || "09:00").split(":");
  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <select
        value={h}
        onChange={(e) => onChange(`${e.target.value}:${m}`)}
        aria-label={ariaLabel ? `${ariaLabel} (hora)` : "Hora"}
        className="h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-1.5 text-xs sm:text-sm tabular-nums"
      >
        {HOURS.map((hh) => (
          <option key={hh} value={hh}>{hh}</option>
        ))}
      </select>
      <span className="text-muted-foreground text-sm flex-shrink-0">:</span>
      <select
        value={m}
        onChange={(e) => onChange(`${h}:${e.target.value}`)}
        aria-label={ariaLabel ? `${ariaLabel} (minutos)` : "Minutos"}
        className="h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-1.5 text-xs sm:text-sm tabular-nums"
      >
        {MINUTES.map((mm) => (
          <option key={mm} value={mm}>{mm}</option>
        ))}
        {/* Si el valor guardado no está en pasos de 5 (legado), lo muestro igual. */}
        {!MINUTES.includes(m) && <option value={m}>{m}</option>}
      </select>
    </div>
  );
}
