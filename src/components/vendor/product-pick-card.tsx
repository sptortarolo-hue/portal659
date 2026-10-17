"use client";

import { ProductImage } from "@/components/product-image";
import { isGiftProductRow } from "@/lib/gift-card-share";

export type PickProduct = {
  id: string;
  name: string;
  price: number;
  promo_price?: number | null;
  image_url?: string | null;
  available?: boolean;
  category?: string | null;
  vertical?: string | null;
  /** SKU (las giftcards van por sku GC-<monto> o categoría). */
  sku?: string | null;
  /** Venta en packs (ej: 6). El precio es del paquete. */
  pack_size?: number | null;
  /** Unidad de venta: "kg" = precio por kilo (balanza). */
  unit?: string | null;
};

/**
 * Ficha de producto para armar pedidos (Mostrador y Mesas comparten diseño).
 */
export function ProductPickCard({
  product,
  hasModifiers,
  onAdd,
  isCombo = false,
  comboMembers,
}: {
  product: PickProduct;
  hasModifiers: boolean;
  onAdd: () => void;
  /** El producto es combo (badge + desglose "Incluye"). */
  isCombo?: boolean;
  /** Componentes del combo (del GET offers comboItemsByProduct). */
  comboMembers?: { name: string; qty: number }[];
}) {
  const p = product;
  const isGift = isGiftProductRow(p);
  return (
    <button
      type="button"
      onClick={onAdd}
      className="group text-left rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 hover:shadow-sm transition-all active:scale-[0.98] min-w-0"
    >
      <div className="relative aspect-square">
        <ProductImage
          src={p.image_url}
          name={p.name}
          category={p.category}
          vertical={p.vertical ?? "gastronomia"}
          alt={p.name}
          className="w-full h-full"
          iconClassName="h-10 w-10"
        />
        {isGift && (
          <span className="absolute bottom-2 left-2 rounded-full bg-violet-600 text-white text-[9px] font-bold px-2 py-0.5">
            🎁 Tarjeta
          </span>
        )}
        {isCombo && !isGift && (
          <span className="absolute bottom-2 left-2 rounded-full bg-violet-500 text-white text-[9px] font-bold px-2 py-0.5">
            🧩 Combo
          </span>
        )}
        {isCombo && comboMembers && comboMembers.length > 0 && (
          <span className="block text-[10px] text-violet-700 break-words mt-0.5">
            {(comboMembers.map((c) => (c.qty > 1 ? `${c.qty}× ${c.name}` : c.name)).join(" + ")).slice(0, 90)}
          </span>
        )}
        {p.available === false && (
          <span className="absolute top-2 left-2 rounded-full bg-red-500 text-white text-[9px] font-bold px-2 py-0.5">
            Agotado
          </span>
        )}
        {Number(p.pack_size) >= 2 && (
          <span className="absolute top-2 right-2 rounded-full bg-emerald-600 text-white text-[9px] font-bold px-2 py-0.5">
            pack x{Math.floor(Number(p.pack_size))}
          </span>
        )}
        {(p as any).unit === "kg" && (
          <span className="absolute top-2 right-2 rounded-full bg-sky-600 text-white text-[9px] font-bold px-2 py-0.5">
            $/kg
          </span>
        )}
      </div>
      <div className="p-2 min-w-0">
        <p className="text-xs font-medium line-clamp-2 break-words">{p.name}</p>
        <div className="flex items-baseline gap-1 mt-0.5 flex-wrap min-w-0">
          <span className="text-sm font-semibold text-primary tabular-nums">
            ${Number(p.promo_price ?? p.price).toLocaleString("es-AR")}{(p as any).unit === "kg" ? "/kg" : ""}
          </span>
          {p.promo_price != null && (
            <span className="text-[10px] text-muted-foreground line-through">
              ${Number(p.price).toLocaleString("es-AR")}
            </span>
          )}
        </div>
        {hasModifiers && (
          <span className="inline-block mt-0.5 text-[9px] font-medium text-primary/70">+ opciones</span>
        )}
      </div>
    </button>
  );
}
