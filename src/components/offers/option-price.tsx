"use client";

import {
  normalOptionPrice,
  optionTotalPrice,
  promoOptionPrice,
} from "@/lib/modifier-select";
import type { ModifierOption } from "@/types/database";

/**
 * Precio de una opción de modificador (display único en toda la app):
 * - modo total: `$total` (o `~~$total~~ $promo 🔥`).
 * - modo diferencia: `+$extra` (o `~~+$extra~~ +$promo 🔥`).
 * Sin precio que mostrar (extra $0 sin promo) → null.
 */
export function OptionPrice({
  opt,
  totalMode,
  className = "",
  promoClassName = "",
}: {
  opt: ModifierOption;
  totalMode: boolean;
  className?: string;
  promoClassName?: string;
}) {
  const fmt = (n: number) =>
    totalMode ? `$${n.toLocaleString("es-AR")}` : `+$${n.toLocaleString("es-AR")}`;
  const promo = promoOptionPrice(opt, totalMode);
  if (promo != null) {
    return (
      <span className={className}>
        <span className="line-through opacity-60 font-normal">{fmt(normalOptionPrice(opt, totalMode))}</span>{" "}
        <span className={promoClassName || "font-semibold"}>{fmt(promo)} 🔥</span>
      </span>
    );
  }
  if (totalMode) {
    const t = optionTotalPrice(opt);
    if (t == null) return null;
    return <span className={className}>${t.toLocaleString("es-AR")}</span>;
  }
  if (Number(opt?.price_mod) > 0) {
    return <span className={className}>{fmt(normalOptionPrice(opt, false))}</span>;
  }
  return null;
}
