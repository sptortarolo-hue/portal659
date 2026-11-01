"use client";

import { useMemo } from "react";
import { cashBillSuggestions } from "@/lib/cash-bills";
import { tenderState } from "@/lib/cash-tender";

function fmt(n: number): string {
  return Number(n || 0).toLocaleString("es-AR");
}

export type CashTenderProps = {
  /** Total a cobrar en efectivo (con descuentos ya aplicados). */
  total: number;
  /** Monto tipeado con el que abona ("" = vacío). */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Compacto (panel de mesas / sheet mobile). */
  compact?: boolean;
  className?: string;
};

/**
 * "¿Con cuánto paga?" para el cobro en efectivo de Mostrador y Mesas.
 *
 * Patrón de los POS de referencia (Square: pantalla de "Change due"; Toast:
 * botones de monto rápido): el total siempre visible, chips de un toque
 * ("Exacto" + billetes redondos sugeridos) y el vuelto destacado EN VIVO antes
 * de cobrar. Opcional: vacío = no se envía nada; si no alcanza el total se
 * avisa en rojo pero no se bloquea el cobro.
 */
export function CashTender({ total, value, onChange, disabled = false, compact = false, className }: CashTenderProps) {
  const bills = useMemo(() => cashBillSuggestions(total, 3), [total]);
  const state = tenderState(value, total);

  if (!(Number(total) > 0)) return null;

  return (
    <div
      className={`rounded-xl border border-green-200 bg-green-50/60 dark:border-green-900 dark:bg-green-950/30 ${
        compact ? "px-2 py-1.5" : "p-2.5"
      } space-y-1.5${className ? ` ${className}` : ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-green-900 dark:text-green-200">
          💵 ¿Con cuánto paga? <span className="font-normal text-green-700/80 dark:text-green-300/80">(opcional)</span>
        </span>
        {state.touched && (
          <button
            type="button"
            onClick={() => onChange("")}
            disabled={disabled}
            title="Limpiar el monto"
            className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-green-800/80 hover:bg-green-100 dark:text-green-200/80 dark:hover:bg-green-900/50"
          >
            ✕
          </button>
        )}
      </div>

      {/* Chips de un toque: Exacto + billetes sugeridos (arriba el más chico). */}
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onChange(String(total))}
          disabled={disabled}
          className="rounded-full border border-green-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-green-800 hover:bg-green-100 disabled:opacity-50 dark:border-green-800 dark:bg-green-950 dark:text-green-200 dark:hover:bg-green-900"
        >
          Exacto (${fmt(total)})
        </button>
        {bills.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => onChange(String(b))}
            disabled={disabled}
            className="rounded-full border border-green-300 bg-white px-2.5 py-1 text-[11px] font-medium text-green-800 hover:bg-green-100 disabled:opacity-50 dark:border-green-800 dark:bg-green-950 dark:text-green-200 dark:hover:bg-green-900"
          >
            ${fmt(b)}
          </button>
        ))}
      </div>

      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        maxLength={12}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        placeholder={`Monto con el que paga (total $${fmt(total)})`}
        disabled={disabled}
        className={`w-full min-w-0 rounded-lg border border-input bg-background px-2 tabular-nums disabled:opacity-60 ${
          state.touched && !state.ok ? "border-red-400" : ""
        } ${compact ? "h-7 text-xs" : "h-9 text-sm"}`}
      />

      {state.touched ? (
        state.ok ? (
          <p className="text-sm font-bold text-green-700 dark:text-green-300">
            Vuelto: <span className="tabular-nums">${fmt(state.change)}</span>
          </p>
        ) : (
          <p className="text-[11px] leading-snug text-red-600 dark:text-red-400">
            Falta ${fmt(state.short)} — no alcanza el total, así que no se guarda el monto.
          </p>
        )
      ) : (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Tocá <b>Exacto</b> o el billete y te mostramos el vuelto antes de cobrar.
        </p>
      )}
    </div>
  );
}
