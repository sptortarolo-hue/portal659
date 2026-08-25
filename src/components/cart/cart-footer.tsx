"use client";

import { useCart } from "@/lib/cart";

export function CartFooter() {
  const { count, total, vendor, setOpen } = useCart();

  if (count === 0) return null;

  return (
    <div className="fixed bottom-14 sm:bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-sm shadow-lg animate-slide-in-bottom">
      <div className="container mx-auto px-4 py-3 max-w-4xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div key={count} className="flex items-center justify-center h-9 w-9 rounded-full bg-primary text-primary-foreground text-sm font-bold flex-shrink-0 animate-pop-in">
            {count}
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground truncate">
              {vendor?.storeName}
            </p>
            <p className="font-semibold text-sm">
              ${total.toLocaleString("es-AR")}
            </p>
          </div>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:bg-primary/90 flex-shrink-0"
        >
          Ver pedido
        </button>
      </div>
    </div>
  );
}
