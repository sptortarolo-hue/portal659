"use client";

import { usePathname } from "next/navigation";
import { useCart } from "@/lib/cart";
import { isImmersivePath } from "@/lib/immersive";

export function CartFooter() {
  const pathname = usePathname();
  const { count, total, vendor, setOpen } = useCart();

  // Pantalla TV: sin barra de carrito (es la pantalla del local).
  if (isImmersivePath(pathname)) return null;
  if (count === 0) return null;

  return (
    <div className="pv2 fixed bottom-14 sm:bottom-0 left-0 right-0 z-40 border-t border-border bg-card shadow-lg animate-slide-in-bottom">
      <div className="container mx-auto px-4 py-3 max-w-4xl flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div key={count} className="pv2-cart-badge flex h-9 w-9 flex-shrink-0 animate-pop-in items-center justify-center rounded-full text-sm">
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
          className="pv2-btn pv2-btn-primary flex-shrink-0 px-5 py-2.5 text-sm"
        >
          Ver pedido
        </button>
      </div>
    </div>
  );
}
