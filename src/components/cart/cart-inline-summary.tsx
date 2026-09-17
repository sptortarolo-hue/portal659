"use client";

import { useCart } from "@/lib/cart";
import { cartLineTotal } from "@/lib/order-line";

export function CartInlineSummary() {
  const { items, vendor, total, count, setOpen } = useCart();

  if (count === 0) return null;

  return (
    <div className="mt-8 mb-24 border border-border rounded-2xl p-6 bg-card">
      <h3 className="font-display text-xl font-semibold mb-4">
        Tu pedido en {vendor?.storeName}
      </h3>
      <ul className="divide-y divide-border">
        {items.map((item, idx) => {
          const modTotal = (item.modifiers || []).reduce((s, m) => s + m.price_mod, 0);
          const unitTotal = item.price + modTotal;
          const lineTotal = cartLineTotal(item);
          return (
            <li key={`${item.offerId}-${idx}`} className="py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  {item.qty}x {item.name}
                </span>
                <span className="font-medium">
                  ${lineTotal.toLocaleString("es-AR")}
                </span>
              </div>
              {item.modifiers && item.modifiers.length > 0 && (
                <div className="mt-1 ml-4 text-xs text-muted-foreground">
                  {item.modifiers.map((m, mi) => (
                    <span key={mi}>
                      {m.label}
                      {m.price_mod > 0 && ` (+$${m.price_mod.toLocaleString("es-AR")})`}
                      {mi < item.modifiers!.length - 1 ? " · " : ""}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
        <span className="font-semibold">
          Total: ${total.toLocaleString("es-AR")}
        </span>
        <button
          onClick={() => setOpen(true)}
          className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:bg-primary/90"
        >
          Confirmar pedido
        </button>
      </div>
    </div>
  );
}
