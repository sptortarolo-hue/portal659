"use client";

import { cashAppliesToItem, cashPrice, normalizeCashPct } from "@/lib/cash-discount";

const fmt = (n: number) => `$${Number(n || 0).toLocaleString("es-AR")}`;

/**
 * Precio con doble valor: lista tachado + efectivo + pill de descuento.
 * Sin descuento aplicable, renderiza el precio plano (mismo look que antes).
 */
export function CashPrice({
  price,
  hasPromo = false,
  excluded = false,
  cashPct = 0,
  size = "md",
  plainClassName = "font-bold",
  prefix = "",
}: {
  /** Precio de venta vigente (promo si hay, si no lista). */
  price: number;
  hasPromo?: boolean;
  /** Promo excluida por el comercio: no recibe el descuento. */
  excluded?: boolean | null;
  /** % del comercio (0/NULL = sin descuento). */
  cashPct?: number | null;
  size?: "sm" | "md" | "lg";
  plainClassName?: string;
  /** Prefijo (ej. "Desde " para rangos de variantes). */
  prefix?: string;
}) {
  const pct = normalizeCashPct(cashPct);
  const applies = pct > 0 && cashAppliesToItem({ hasPromo, excluded });
  if (!applies) return <span className={plainClassName}>{fmt(price)}</span>;
  const cash = cashPrice(price, pct);
  if (cash >= Number(price)) return <span className={plainClassName}>{fmt(price)}</span>;

  const cashCls =
    size === "lg"
      ? "font-display text-2xl font-bold text-primary"
      : size === "sm"
        ? "text-xs font-bold text-primary"
        : "font-bold text-primary";
  const listCls =
    size === "lg"
      ? "text-sm text-muted-foreground line-through"
      : "text-[10px] text-muted-foreground line-through";

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className={listCls}>{prefix}{fmt(price)}</span>
      <span className={cashCls}>{fmt(cash)}</span>
      <span className="text-[9px] font-bold text-green-700 bg-green-100 rounded-full px-1.5 py-0.5 tabular-nums">
        −{Number(pct).toLocaleString("es-AR")}% efvo
      </span>
    </span>
  );
}
