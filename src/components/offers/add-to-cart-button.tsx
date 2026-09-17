"use client";

import { useState, useCallback } from "react";
import { useCart } from "@/lib/cart";
import type { CartModifier, CartVolumeGroup } from "@/lib/cart";
import type { ProductModifier } from "@/types/database";
import { ModifierPicker } from "./modifier-picker";
import { useToast } from "@/lib/toast";

type AddToCartButtonProps = {
  offerId: string;
  name: string;
  price: number;
  vendor: {
    id: string;
    slug: string;
    storeName: string;
    whatsapp: string;
    vertical?: string | null;
    deliveryFee?: number | null;
    freeDeliveryMin?: number | null;
    cashDiscountPct?: number | null;
    volumeGroups?: CartVolumeGroup[];
  };
  modifiers?: ProductModifier[];
  /** La promo de este ítem está excluida del descuento en efectivo. */
  cashExcluded?: boolean;
  /** Precio de lista (si price trae promo, para espejo de volumen). */
  origPrice?: number;
  /** El price viene de una promo. */
  hasPromo?: boolean;
  /** Pack (ej: 6): el quick-add agrega un pack completo por click. */
  packSize?: number;
  /** Precio del paquete completo (fuente del dinero con pack). */
  packPrice?: number;
};

export function AddToCartButton({
  offerId,
  name,
  price,
  vendor,
  modifiers,
  cashExcluded,
  origPrice,
  hasPromo,
  packSize,
  packPrice,
}: AddToCartButtonProps) {
  const { addItem } = useCart();
  const { addToast } = useToast();
  const [added, setAdded] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  const doAdd = useCallback(
    (mods?: CartModifier[]) => {
      const switched = addItem(vendor, {
        offerId,
        name,
        price,
        qty: packSize && packSize >= 2 ? packSize : 1,
        modifiers: mods,
        cashExcluded,
        origPrice,
        hasPromo,
        packSize: packSize && packSize >= 2 ? packSize : undefined,
        packPrice: packPrice && packSize && packSize >= 2 ? packPrice : undefined,
      });
      if (switched) {
        addToast("Se limpió el carrito anterior (solo podés pedir de un local a la vez)");
      } else {
        addToast(`${name} agregado al carrito`);
      }
      setAdded(true);
      setTimeout(() => setAdded(false), 1500);
    },
    [addItem, vendor, offerId, name, price, cashExcluded, origPrice, hasPromo, packSize, packPrice, addToast]
  );

  const handleClick = useCallback(() => {
    if (modifiers && modifiers.length > 0) {
      setShowPicker(true);
    } else {
      doAdd();
    }
  }, [modifiers, doAdd]);

  return (
    <>
      <button
        onClick={handleClick}
        disabled={added}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
          added
            ? "bg-green-500 text-white animate-pop-in"
            : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95"
        }`}
      >
        {added ? "✓ Agregado" : "Agregar"}
      </button>

      {showPicker && (
        <ModifierPicker
          modifiers={modifiers!}
          productName={name}
          basePrice={price}
          onConfirm={(selected, _finalPrice) => {
            doAdd(selected.length > 0 ? selected : undefined);
            setShowPicker(false);
          }}
          onCancel={() => setShowPicker(false)}
        />
      )}
    </>
  );
}
