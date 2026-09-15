"use client";

import { useMemo } from "react";
import { useCart, type CartVolumeGroup } from "@/lib/cart";

/**
 * Progreso hacia los precios por volumen ("Sumás 9/12 para la docena").
 * Espejo visual: el servidor recalcula y manda.
 */
export function VolumeProgress({ groups }: { groups: CartVolumeGroup[] }) {
  const { items } = useCart();

  const rows = useMemo(() => {
    if (!groups || groups.length === 0 || items.length === 0) return [];
    const out: { id: string; name: string; qty: number; nextMin: number; nextLabel: string; done: boolean }[] = [];
    for (const g of groups) {
      const ids = new Set((g.productIds || []).map(String));
      const qty = items.reduce((s, i) => (ids.has(String(i.offerId)) ? s + i.qty : s), 0);
      if (qty === 0) continue;
      const tiers = [...(g.tiers || [])].sort((a, b) => a.minQty - b.minQty);
      if (tiers.length === 0) continue;
      const next = tiers.find((t) => t.minQty > qty) || tiers[tiers.length - 1];
      const done = qty >= next.minQty;
      const nextLabel =
        next.kind === "fixed_total"
          ? `${next.minQty}x $${Number(next.value).toLocaleString("es-AR")}`
          : `${next.minQty}+ con ${Number(next.value).toLocaleString("es-AR")}% off`;
      out.push({ id: g.id, name: g.name, qty, nextMin: next.minQty, nextLabel, done });
    }
    return out;
  }, [groups, items]);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2 my-3">
      {rows.map((r) => (
        <div
          key={r.id}
          className={`rounded-xl border px-3 py-2 text-xs font-medium ${
            r.done
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-muted/50 border-border text-muted-foreground"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span>
              📦 {r.name}:{" "}
              {r.done ? (
                <>¡tenés {r.qty} y corre {r.nextLabel}! 🎉</>
              ) : (
                <>sumás {r.qty}/{r.nextMin} para {r.nextLabel}</>
              )}
            </span>
          </div>
          {!r.done && (
            <div className="mt-1.5 h-1.5 rounded-full bg-border/60 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, Math.round((r.qty / r.nextMin) * 100))}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
