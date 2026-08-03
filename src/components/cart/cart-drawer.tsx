"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart";

export function CartDrawer() {
  const { open, setOpen, items, vendor, total, count, setQty, clear } = useCart();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40"
      onClick={() => setOpen(false)}
    >
      <div
        className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-bold">
            Tu pedido{vendor ? ` en ${vendor.storeName}` : ""}
          </h2>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-500 hover:text-gray-700"
            aria-label="Cerrar"
          >
            X
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {items.length === 0 ? (
            <p className="text-gray-500 text-center py-10">
              Todavía no agregaste nada.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.offerId}
                className="flex items-center justify-between border rounded-lg p-3"
              >
                <div>
                  <p className="font-medium text-sm">{item.name}</p>
                  <p className="text-sm text-gray-500">
                    ${Number(item.price).toLocaleString("es-AR")} c/u
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center border rounded-md">
                    <button
                      onClick={() => setQty(item.offerId, item.qty - 1)}
                      className="px-2 py-1 text-gray-500 hover:text-gray-800"
                    >
                      -
                    </button>
                    <span className="w-8 text-center text-sm">{item.qty}</span>
                    <button
                      onClick={() => setQty(item.offerId, item.qty + 1)}
                      className="px-2 py-1 text-gray-500 hover:text-gray-800"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-sm font-semibold w-20 text-right">
                    ${Number(item.price * item.qty).toLocaleString("es-AR")}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && vendor && (
          <div className="border-t px-6 py-4 space-y-3">
            <div className="flex justify-between font-bold">
              <span>Total ({count} items)</span>
              <span>${total.toLocaleString("es-AR")}</span>
            </div>
            <Link
              href={`/checkout?tienda=${vendor.slug}`}
              className="block w-full rounded-md bg-primary text-primary-foreground text-center text-sm font-medium py-2.5 hover:bg-primary/90"
            >
              Confirmar pedido
            </Link>
            <button
              onClick={clear}
              className="w-full text-center text-xs text-gray-400 hover:text-gray-600"
            >
              Vaciar carrito
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
