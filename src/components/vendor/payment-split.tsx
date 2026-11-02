"use client";

import { useMemo } from "react";
import type { SplitMethod } from "@/lib/order-payments";
import { parseMonto, round2 } from "@/lib/cash-tender";

/** Métodos combinables (mismos que el server: `SPLIT_METHODS`). El import es
 *  solo de tipos: el módulo server no entra en el bundle del cliente. */
export const COMBINED_METHODS: SplitMethod[] = ["efectivo", "transferencia", "tarjeta"];

export const COMBINED_METHOD_LABEL: Record<SplitMethod, string> = {
  efectivo: "💵 Efectivo",
  transferencia: "🏦 Transferencia",
  tarjeta: "💳 Tarjeta",
};

/** Una línea del desglose. Montos como texto: el cajero tipea coma o punto. */
export type SplitRow = {
  key: string;
  method: SplitMethod;
  amount: string;
  /** Efectivo: lo que entregó el cliente (para el vuelto en vivo). */
  tendered: string;
};

export type PaymentSplitProps = {
  /** Saldo a cubrir (total con descuentos ya aplicados, menos lo ya pagado). */
  total: number;
  rows: SplitRow[];
  onChange: (rows: SplitRow[]) => void;
  /** Rótulo del contexto: "la mesa", "la venta". */
  subject?: string;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
};

function fmt(n: number): string {
  return Number(n || 0).toLocaleString("es-AR");
}

let seq = 0;
function newRow(method: SplitMethod = "efectivo"): SplitRow {
  seq += 1;
  return { key: `split-${Date.now().toString(36)}-${seq}`, method, amount: "", tendered: "" };
}

/**
 * Pago combinado (split payment): el desglose real de cómo se cobra.
 *
 * Patrón de los POS de referencia (Square "Split payment", Toast/Upserve con
 * saldo restante, Shopify "Remaining to pay", Loyverse "Split"):
 *  - total visible y **"Falta $X" en vivo** mientras se cubre el saldo,
 *  - atajos de un toque: **"Resto en efectivo" / "Resto en tarjeta"**
 *    (setean el saldo pendiente en la última línea),
 *  - la línea de efectivo muestra el **vuelto** con lo que entregó el cliente,
 *  - y el cobro solo se habilita cuando falta $0 (acá sí se bloquea: una
 *    venta a medias descuadra la caja).
 *
 * Se usa igual en desktop y mobile porque vive dentro del bloque de pago
 * compartido (`orderFooter` del Mostrador, panel/footer de Mesas).
 */
export function PaymentSplit({
  total,
  rows,
  onChange,
  subject = "la venta",
  disabled = false,
  compact = false,
  className,
}: PaymentSplitProps) {
  const tot = Math.max(0, Number(total) || 0);
  const paid = round2(rows.reduce((s, r) => s + parseMonto(r.amount), 0));
  const missing = round2(Math.max(0, tot - paid));
  const covered = tot > 0 && missing <= 0.01;
  const options = useMemo(() => COMBINED_METHODS.filter((m) => !rows.some((r) => r.method === m)), [rows]);
  const valid = covered && rows.length > 0 && rows.every((r) => parseMonto(r.amount) > 0);

  const update = (key: string, patch: Partial<SplitRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** Setea el saldo que falta en la última línea (o agrega una). */
  const fillRest = (method: SplitMethod) => {
    if (!(missing > 0)) return;
    const rest = String(round2(missing));
    const row = rows.find((r) => r.method === method);
    if (row) onChange(rows.map((r) => (r.key === row.key ? { ...r, amount: rest } : r)));
    else onChange([...rows, newRow(method)].map((r) => (r.method === method && r.amount === "" ? { ...r, amount: rest } : r)));
  };

  if (!(tot > 0)) return null;

  const pad = compact ? "px-2 py-1.5" : "p-2.5";
  const inputH = compact ? "h-7 text-xs" : "h-9 text-sm";

  return (
    <div className={`rounded-xl border border-green-200 bg-green-50/60 dark:border-green-900 dark:bg-green-950/30 ${pad} space-y-1.5${className ? ` ${className}` : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-green-900 dark:text-green-200">
          🪙 Pago combinado — {subject} de ${fmt(tot)}
        </span>
        {covered ? (
          <span className="text-[11px] font-semibold text-green-700 dark:text-green-300">Pagado $0 ✓</span>
        ) : (
          <span className="text-[11px] font-bold text-amber-700 dark:text-amber-300">Falta ${fmt(missing)}</span>
        )}
      </div>

      {rows.map((r) => {
        const tendered = parseMonto(r.tendered);
        const amount = parseMonto(r.amount);
        const change = r.method === "efectivo" && tendered > 0 ? round2(Math.max(0, tendered - amount)) : 0;
        return (
          <div key={r.key} className="space-y-1">
            <div className="flex items-center gap-1">
              <select
                value={r.method}
                onChange={(e) => update(r.key, { method: e.target.value as SplitMethod, tendered: "" })}
                disabled={disabled}
                className={`${inputH} w-[9.5rem] flex-shrink-0 rounded-lg border border-input bg-background px-1.5`}
              >
                {COMBINED_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {COMBINED_METHOD_LABEL[m].replace(/^\S+\s/, "")}
                  </option>
                ))}
              </select>
              <span className="flex-shrink-0 text-xs text-muted-foreground">$</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={r.amount}
                maxLength={12}
                onChange={(e) => update(r.key, { amount: e.target.value.replace(/[^\d.,]/g, "") })}
                placeholder="0"
                disabled={disabled}
                className={`${inputH} min-w-0 flex-1 rounded-lg border border-input bg-background px-2 tabular-nums`}
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                disabled={disabled}
                title="Quitar este medio"
                className="h-7 w-7 flex-shrink-0 rounded-md text-[11px] text-muted-foreground hover:bg-muted"
              >
                ✕
              </button>
            </div>
            {r.method === "efectivo" && (
              <div className="flex items-center gap-1 pl-1">
                <span className="text-[10px] text-muted-foreground">Entregó</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={r.tendered}
                  maxLength={12}
                  onChange={(e) => update(r.key, { tendered: e.target.value.replace(/[^\d.,]/g, "") })}
                  placeholder={fmt(amount)}
                  disabled={disabled}
                  className={`${inputH} w-24 rounded-lg border border-input bg-background px-2 tabular-nums`}
                />
                {tendered > 0 && (
                  <span className={`text-[11px] font-semibold ${change >= 0 ? "text-green-700 dark:text-green-300" : "text-red-600"}`}>
                    {change >= 0 ? `Vuelto $${fmt(change)}` : "No alcanza"}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-1">
        {missing > 0 && (
          <>
            <button
              type="button"
              onClick={() => fillRest("efectivo")}
              disabled={disabled || rows.some((r) => r.method === "efectivo")}
              className="rounded-full border border-green-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-green-800 hover:bg-green-100 disabled:opacity-40 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
            >
              Resto en efectivo
            </button>
            <button
              type="button"
              onClick={() => fillRest("tarjeta")}
              disabled={disabled || rows.some((r) => r.method === "tarjeta")}
              className="rounded-full border border-green-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-green-800 hover:bg-green-100 disabled:opacity-40 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
            >
              Resto en tarjeta
            </button>
          </>
        )}
        {options.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([...rows, newRow(options[0])])}
            disabled={disabled}
            className="rounded-full border border-dashed border-green-400 px-2.5 py-1 text-[11px] font-medium text-green-700 hover:bg-green-100 disabled:opacity-40 dark:text-green-300"
          >
            ＋ Sumar medio
          </button>
        )}
      </div>

      {!covered && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Cubrí el saldo con uno o más medios para poder cobrar (faltan ${fmt(missing)}).
        </p>
      )}
    </div>
  );
}

/** ¿El desglose cubre exactamente el total? (para habilitar el cobro). */
export function splitCoversTotal(rows: SplitRow[], total: number): boolean {
  const tot = Math.max(0, Number(total) || 0);
  if (!(tot > 0)) return false;
  if (rows.length === 0) return false;
  const paid = round2(rows.reduce((s, r) => s + parseMonto(r.amount), 0));
  return paid >= tot - 0.01;
}

/**
 * Payload para el server: descarta líneas vacías y manda los números ya
 * redondeados (el tender solo en efectivo). Devuelve null si no hay nada
 * utilizable (el caller manda el medio único de siempre).
 */
export function splitPayload(rows: SplitRow[]): { method: SplitMethod; amount: number; tendered?: number }[] | null {
  const out: { method: SplitMethod; amount: number; tendered?: number }[] = [];
  for (const r of rows) {
    const amount = round2(parseMonto(r.amount));
    if (!(amount > 0)) continue;
    const tendered = round2(parseMonto(r.tendered));
    out.push({
      method: r.method,
      amount,
      ...(r.method === "efectivo" && tendered >= amount ? { tendered } : {}),
    });
  }
  return out.length > 0 ? out : null;
}
