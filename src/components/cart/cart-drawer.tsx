"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart";
import type { CartModifier } from "@/lib/cart";

function buildWhatsAppHref(
  storeName: string,
  whatsapp: string,
  items: { name: string; qty: number; price: number; modifiers?: CartModifier[] }[],
  total: number
): string | null {
  const digits = (whatsapp || "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  const lines = items.map((i) => {
    const mods = i.modifiers && i.modifiers.length > 0
      ? ` (${i.modifiers.map((m) => m.label).join(", ")})`
      : "";
    return `- ${i.qty}x ${i.name}${mods} ($${(i.price * i.qty).toLocaleString("es-AR")})`;
  });
  const text = [
    `Hola ${storeName}! Quiero hacer un pedido:`,
    "",
    ...lines,
    "",
    `Total: $${total.toLocaleString("es-AR")}`,
  ].join("\n");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function CartDrawer() {
  const { open, setOpen, items, vendor, total, count, setQty, removeItem, clear } = useCart();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 transition-opacity animate-fade-in-up"
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
                      <p className="font-medium text-sm leading-tight">{item.name}</p>
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
                            item.qty - 1,
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
                            item.qty + 1,
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
          <div className="border-t border-border px-6 py-4 space-y-3 bg-card">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {count} producto{count !== 1 ? "s" : ""}
              </span>
              <span className="text-lg font-bold">
                ${total.toLocaleString("es-AR")}
              </span>
            </div>
            <Link
              href={`/checkout?tienda=${vendor.slug}`}
              onClick={() => setOpen(false)}
              className="block w-full rounded-xl bg-primary text-primary-foreground text-center text-sm font-medium py-3 hover:bg-primary/90 transition-colors"
            >
              Confirmar pedido
            </Link>
            {(() => {
              const waHref = buildWhatsAppHref(vendor.storeName, vendor.whatsapp, items, total);
              if (!waHref) return null;
              return (
                <a
                  href={waHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center justify-center gap-2 text-xs text-muted-foreground hover:text-green-600 transition-colors py-1"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  ¿Preferís pedirlo por WhatsApp?
                </a>
              );
            })()}
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
