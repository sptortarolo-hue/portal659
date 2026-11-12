"use client";

import { useEffect, useMemo, useState } from "react";
import type { SplitMethod } from "@/lib/order-payments";
import { parseMonto, round2 } from "@/lib/cash-tender";
import {
  bankAccountLabel,
  needsAccountPicker,
  pickDefaultAccount,
  type VendorBankAccount,
} from "@/lib/bank-accounts";
import { BankAccountPickerModal } from "@/components/vendor/bank-account-picker";
import { Modal } from "@/components/ui/modal";

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
  /** Cuenta destino cuando method === 'transferencia' (multi-cuenta). */
  accountId?: string | null;
  accountLabel?: string | null;
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
  /** Cuentas del comercio (si hay 2+ activas se pide elegir). */
  accounts?: VendorBankAccount[] | null;
};

function fmt(n: number): string {
  return Number(n || 0).toLocaleString("es-AR");
}

let seq = 0;
function newRow(method: SplitMethod = "efectivo"): SplitRow {
  seq += 1;
  return { key: `split-${Date.now().toString(36)}-${seq}`, method, amount: "", tendered: "", accountId: null, accountLabel: null };
}

/**
 * ¿Falta elegir la cuenta en alguna fila de transferencia? (solo cuando hay 2+
 * cuentas activas). El caller puede bloquear el cobro en ese caso.
 */
export function splitNeedsAccount(rows: SplitRow[], accounts: VendorBankAccount[] | null | undefined): boolean {
  const picker = needsAccountPicker(accounts);
  if (!picker) return false;
  return (rows || []).some((r) => r.method === "transferencia" && !r.accountId);
}

/**
 * Pago combinado (split payment): el desglose real de cómo se cobra.
 * Con multi-cuenta, las filas de transferencia llevan la cuenta elegida
 * (modal si hay 2+ activas; con 1 se asigna la principal sin preguntar).
 */
export function PaymentSplit({
  total,
  rows,
  onChange,
  subject = "la venta",
  disabled = false,
  compact = false,
  className,
  accounts,
}: PaymentSplitProps) {
  const tot = Math.max(0, Number(total) || 0);
  const paid = round2(rows.reduce((s, r) => s + parseMonto(r.amount), 0));
  const missing = round2(Math.max(0, tot - paid));
  const covered = tot > 0 && missing <= 0.01;
  const options = useMemo(() => COMBINED_METHODS.filter((m) => !rows.some((r) => r.method === m)), [rows]);
  const activeAccounts = (accounts || []).filter((a) => a.active !== false);
  const pickerNeeded = needsAccountPicker(accounts);
  const defaultAccount = activeAccounts.length === 1 ? activeAccounts[0] : pickDefaultAccount(activeAccounts);

  const [pickerKey, setPickerKey] = useState<string | null>(null);

  // Auto-asignar la cuenta principal cuando hay una sola cuenta activa (o la
  // principal) a las filas de transferencia que aún no tienen cuenta (incluidos
  // drafts restaurados del storage). Con 2+ cuentas se exige elegir (modal).
  useEffect(() => {
    if (activeAccounts.length !== 1 || !defaultAccount) return;
    let changed = false;
    const next = rows.map((r) => {
      if (r.method === "transferencia" && !r.accountId) {
        changed = true;
        return { ...r, accountId: defaultAccount.id, accountLabel: bankAccountLabel(defaultAccount) };
      }
      return r;
    });
    if (changed) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccounts.length, defaultAccount?.id]);

  const update = (key: string, patch: Partial<SplitRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  /** Setea el saldo que falta en la última línea (o agrega una). */
  const fillRest = (method: SplitMethod) => {
    if (!(missing > 0)) return;
    const rest = String(round2(missing));
    const row = rows.find((r) => r.method === method);
    if (row) {
      onChange(rows.map((r) => (r.key === row.key ? { ...r, amount: rest } : r)));
      if (method === "transferencia" && pickerNeeded) setPickerKey(row.key);
    } else {
      const nr = newRow(method);
      nr.amount = rest;
      if (method === "transferencia") {
        if (pickerNeeded) {
          // se asigna al elegir en el modal
        } else if (defaultAccount) {
          nr.accountId = defaultAccount.id;
          nr.accountLabel = bankAccountLabel(defaultAccount);
        }
      }
      onChange([...rows, nr]);
      if (method === "transferencia" && pickerNeeded) setPickerKey(nr.key);
    }
  };

  if (!(tot > 0)) return null;

  const pad = compact ? "px-2 py-1.5" : "p-2.5";
  const inputH = compact ? "h-7 text-xs" : "h-9 text-sm";
  const chip =
    "rounded-full border border-input bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-40";

  const pickerOpenRow = pickerKey ? rows.find((r) => r.key === pickerKey) : null;

  return (
    <div className={`rounded-xl border border-border bg-muted/40 ${pad} space-y-1.5${className ? ` ${className}` : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-foreground">
          🪙 Pago combinado — {subject} de ${fmt(tot)}
        </span>
        {covered ? (
          <span className="text-[11px] font-bold text-primary">Pagado ✓</span>
        ) : (
          <span className="text-[11px] font-bold text-destructive">Falta ${fmt(missing)}</span>
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
                onChange={(e) => {
                  const newMethod = e.target.value as SplitMethod;
                  const patch: Partial<SplitRow> = { method: newMethod, tendered: "" };
                  if (newMethod !== "transferencia") {
                    patch.accountId = null;
                    patch.accountLabel = null;
                  } else if (!pickerNeeded && defaultAccount) {
                    patch.accountId = defaultAccount.id;
                    patch.accountLabel = bankAccountLabel(defaultAccount);
                  }
                  update(r.key, patch);
                  if (newMethod === "transferencia" && pickerNeeded) setPickerKey(r.key);
                }}
                disabled={disabled}
                className={`${inputH} w-[9.5rem] flex-shrink-0 rounded-lg border border-input bg-background px-1.5 text-foreground`}
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
                  <span className={`text-[11px] font-bold ${change >= 0 ? "text-primary" : "text-destructive"}`}>
                    {change >= 0 ? `Vuelto $${fmt(change)}` : "No alcanza"}
                  </span>
                )}
              </div>
            )}
            {r.method === "transferencia" && pickerNeeded && (
              <div className="flex items-center gap-1 pl-1">
                {r.accountId ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setPickerKey(r.key)}
                    className="rounded-full border border-border bg-background px-2.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-muted"
                    title="Cambiar cuenta"
                  >
                    🏦 {r.accountLabel || "Cuenta"} · cambiar
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => setPickerKey(r.key)}
                    className="rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-[10px] font-bold text-destructive hover:bg-destructive/20"
                  >
                    ⚠️ Elegir cuenta
                  </button>
                )}
              </div>
            )}
            {r.method === "transferencia" && !pickerNeeded && r.accountLabel && (
              <div className="pl-1 text-[10px] text-muted-foreground">🏦 {r.accountLabel}</div>
            )}
          </div>
        );
      })}

      {/* Medios habituales de un toque: cargo el saldo que falta en ese medio
          (si no existe la línea, la agrega). "Sumar medio" es para el resto. */}
      <div className="flex flex-wrap items-center gap-1">
        {missing > 0 && (
          <>
            <button type="button" onClick={() => fillRest("efectivo")} disabled={disabled} className={chip}>
              💵 Efectivo ${fmt(missing)}
            </button>
            <button type="button" onClick={() => fillRest("transferencia")} disabled={disabled} className={chip}>
              🏦 Transferencia ${fmt(missing)}
            </button>
          </>
        )}
        {options.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([...rows, newRow(options[0])])}
            disabled={disabled}
            className="rounded-full border border-dashed border-input px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-40"
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

      {pickerKey && (
        <BankAccountPickerModal
          accounts={accounts}
          open={true}
          onClose={() => setPickerKey(null)}
          onPick={(acc) => {
            if (pickerKey) {
              update(pickerKey, { accountId: acc.id, accountLabel: bankAccountLabel(acc) });
            }
            setPickerKey(null);
          }}
          title="¿A qué cuenta va la transferencia?"
          hint="La cuenta elegida queda registrada en el cobro y en los informes."
        />
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
export function splitPayload(rows: SplitRow[]): { method: SplitMethod; amount: number; tendered?: number; bankAccountId?: string | null }[] | null {
  const out: { method: SplitMethod; amount: number; tendered?: number; bankAccountId?: string | null }[] = [];
  for (const r of rows) {
    const amount = round2(parseMonto(r.amount));
    if (!(amount > 0)) continue;
    const tendered = round2(parseMonto(r.tendered));
    out.push({
      method: r.method,
      amount,
      ...(r.method === "efectivo" && tendered >= amount ? { tendered } : {}),
      ...(r.method === "transferencia" && r.accountId ? { bankAccountId: r.accountId } : {}),
    });
  }
  return out.length > 0 ? out : null;
}
