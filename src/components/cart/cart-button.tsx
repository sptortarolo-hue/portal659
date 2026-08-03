"use client";

import { useCart } from "@/lib/cart";

export function CartButton() {
  const { count, setOpen } = useCart();

  if (count === 0) return null;

  return (
    <button
      onClick={() => setOpen(true)}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-5 py-3 shadow-lg hover:bg-primary/90 text-sm font-medium"
    >
      <span>Ver pedido</span>
      <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{count}</span>
    </button>
  );
}
