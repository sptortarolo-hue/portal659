"use client";

import { useCart } from "@/lib/cart";

type AddToCartButtonProps = {
  offerId: string;
  name: string;
  price: number;
  vendor: {
    id: string;
    slug: string;
    storeName: string;
    whatsapp: string;
  };
};

export function AddToCartButton({
  offerId,
  name,
  price,
  vendor,
}: AddToCartButtonProps) {
  const { addItem } = useCart();

  return (
    <button
      onClick={() =>
        addItem(vendor, { offerId, name, price, qty: 1 })
      }
      className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90"
    >
      Agregar
    </button>
  );
}
