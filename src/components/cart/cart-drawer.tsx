"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useCart } from "@/lib/cart";
import { mirrorVolume } from "@/lib/volume-mirror";

export function CartDrawer() {
  const { open, setOpen, items, vendor, total, count, setQty, removeItem, clear } = useCart();
  const vol = useMemo(() => mirrorVolume(items, vendor?.volumeGroups), [items, vendor]);
  const netTotal = total - vol.volumeDiscount;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 transition-opacity animate-fade-in-up"
      onClick={() => setOpen(false)}
    >
      <div
        className="absolute right-0 top-0 h-full w-full max-w-md bg-card shadow-xl flex flex-col animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Tu pedido</h2>
            {vendor && (
              <p className="text-xs text-muted-foreground">{vendor.storeName}</p>
            )}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="h-8 w-8 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Cerrar"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {items.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-4xl mb-3">🛒</div>
              <p className="text-muted-foreground">Tu carrito está vacío</p>
              <p className="text-xs text-muted-foreground mt-1">
                Agregá productos de un local para empezar
              </p>
            </div>
          ) : (
            items.map((item, idx) => {
              const modTotal = (item.modifiers || []).reduce((s, m) => s + m.price_mod, 0);
              const unitPrice = item.price + modTotal;
              const key = `${item.offerId}-${JSON.stringify(item.modifiers || [])}`;
              return (
                <div
                  key={key}
                  className="border border-border rounded-xl p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm leading-tight">
                        {item.name}
                        {item.packSize ? (
                          <span className="ml-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 whitespace-nowrap">pack x{item.packSize}</span>
                        ) : null}
                      </p>
                      {item.modifiers && item.modifiers.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.modifiers.map((m, mi) => (
                            <span
                              key={mi}
                              className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                            >
                              {m.label}
                              {m.price_mod > 0 && ` +$${m.price_mod.toLocaleString("es-AR")}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => removeItem(item.offerId, item.modifiers)}
                      className="text-muted-foreground hover:text-red-500 flex-shrink-0 p-1"
                      aria-label="Eliminar"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center border border-border rounded-lg">
                      <button
                        onClick={() =>
                          setQty(
                            item.offerId,
                            item.qty - (item.packSize || 1),
                            item.modifiers
                          )
                        }
                        className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-l-lg transition-colors"
                      >
                        −
                      </button>
                      <span className="w-10 text-center text-sm font-medium tabular-nums">
                        {item.qty}
                      </span>
                      <button
                        onClick={() =>
                          setQty(
                            item.offerId,
                            item.qty + (item.packSize || 1),
                            item.modifiers
                          )
                        }
                        className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-r-lg transition-colors"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-sm font-bold tabular-nums">
                      ${(unitPrice * item.qty).toLocaleString("es-AR")}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && vendor && (
          <div className="border-t border-border px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] space-y-3 bg-card">
            {vol.volumeDiscount > 0 && (
              <div className="flex items-center justify-between text-sm font-medium text-emerald-700">
                <span>📦 Desc. volumen{vol.applied.length > 0 ? ` (${vol.applied.map((a) => a.label).join(" · ")})` : ""}</span>
                <span className="tabular-nums">−${vol.volumeDiscount.toLocaleString("es-AR")}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {count} producto{count !== 1 ? "s" : ""}
              </span>
              <span className="text-lg font-bold">
                ${netTotal.toLocaleString("es-AR")}
              </span>
            </div>
            <Link
              href={`/checkout?tienda=${vendor.slug}`}
              onClick={() => setOpen(false)}
              className="block w-full rounded-xl bg-primary text-primary-foreground text-center text-sm font-medium py-3 hover:bg-primary/90 transition-colors"
            >
              Confirmar pedido
            </Link>
            <button
              onClick={clear}
              className="w-full text-center text-xs text-muted-foreground hover:text-red-500 transition-colors py-1"
            >
              Vaciar carrito
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
