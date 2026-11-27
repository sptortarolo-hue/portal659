"use client";

import { useState } from "react";
import { Puzzle } from "lucide-react";
import { GastroProductRow } from "@/components/store/gastro-product-row";
import { ProductCard } from "@/components/store/product-card";
import { ComboBuilderSheet } from "@/components/store/combo-builder";
import { ProductImage } from "@/components/product-image";
import type { CartVendor } from "@/lib/cart";
import type { ProductModifier } from "@/types/database";

export type ComboItem = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  promo_price: number | null;
  image_url?: string | null;
  category?: string | null;
};
/**
 * Sección Combos del micrositio: armarlo en el panel, se venden acá como
 * un producto más (precio combo fijado por el local). La tarjeta muestra el
 * desglose "Incluye" de combo_items; al tocar abre la ficha real del combo
 * (la misma del menú: galería, modificadores, cantidad, agregar).
 */
export function ComboSection({
  items,
  membersByCombo,
  vendor,
  modifiersByProduct,
  variantsByProduct,
  imagesByProduct,
  acceptsCart,
  consultHref,
}: {
  items: ComboItem[];
  /** combo_id → líneas cargadas de combo_items (para el desglose). */
  membersByCombo: Record<string, { product_id: string; qty: number; name: string; price: number }[]>;
  vendor: CartVendor;
  modifiersByProduct?: Record<string, ProductModifier[]>;
  variantsByProduct?: Record<string, any[]>;
  imagesByProduct?: Record<string, any[]>;
  acceptsCart: boolean;
  consultHref: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const selected = (items || []).find((o) => o.id === selectedId) ?? null;
  const building = (items || []).find((o) => o.id === buildingId) ?? null;
  const isModa = vendor.vertical === "moda";

  /** Armado por unidad: si ALGÚN componente del combo se vende por variante,
   * la venta abre el armado (en vez de la ficha común). */
  const hasVariantMembers = (comboId: string) =>
    (membersByCombo?.[comboId] || []).some(
      (m) => (variantsByProduct?.[m.product_id] || []).length > 0
    );

  if (!items || items.length === 0) return null;
  const fmt = (n: number) => `$${Number(n).toLocaleString("es-AR")}`;
  return (
    <section className="mt-6 mb-10 scroll-mt-[184px] sm:scroll-mt-24">
      <h3 className="pv2-title text-xl mb-1 flex items-center gap-2"><Puzzle className="h-5 w-5 pv2-icon-accent" /> Combos</h3>
      <p className="text-xs text-muted-foreground mb-3">Armados por el local · Tocá para ver qué trae</p>
      <div className="space-y-3">
        {items.map((o) => {
          const pct =
            o.promo_price != null && Number(o.promo_price) > 0 && Number(o.promo_price) < Number(o.price)
              ? Math.round((1 - Number(o.promo_price) / Number(o.price)) * 100)
              : 0;
          const members = membersByCombo?.[o.id] || [];
          const incluye =
            members.length > 0
              ? members.map((m) => (m.qty > 1 ? `${m.qty}× ${m.name}` : m.name)).join(" + ")
              : null;
          const incluyeSum = members.reduce((a, m) => a + (Number(m.price) || 0) * (m.qty || 1), 0);
          return acceptsCart ? (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                // Si el combo tiene piezas por variante → armado por unidad;
                // si no, la ficha normal (foto, descripción, cantidad, agregar).
                if (hasVariantMembers(o.id)) setBuildingId(o.id);
                else setSelectedId(o.id);
              }}
              className="pv2-card w-full text-left p-3 flex items-center gap-3 cursor-pointer"
            >
              <div className="w-20 aspect-square overflow-hidden rounded-xl flex-shrink-0">
                <ProductImage
                  src={o.image_url || null}
                  name={o.name}
                  category={o.category}
                  vertical={vendor.vertical}
                  alt={o.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <p className="pv2-title text-sm line-clamp-2 flex-1">{o.name}</p>
                  <span className="pv2-chip whitespace-nowrap flex-shrink-0">
                    <Puzzle className="h-3 w-3" /> COMBO
                  </span>
                </div>
                {incluye && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 break-words">
                    <span className="font-semibold">Incluye:</span> {incluye}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {pct > 0 ? (
                    <>
                      <span className="pv2-price-old">{fmt(o.price)}</span>
                      <span className="pv2-price">{fmt(o.promo_price!)}</span>
                      {incluyeSum > 0 && Number(o.promo_price) < incluyeSum && (
                        <span className="pv2-chip">Ahorrás {fmt(incluyeSum - Number(o.promo_price))}</span>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="pv2-price">{fmt(o.price)}</span>
                      {incluyeSum > 0 && Number(o.price) < incluyeSum && (
                        <>
                          <span className="pv2-price-old">{fmt(incluyeSum)}</span>
                          <span className="pv2-chip">Ahorrás {fmt(incluyeSum - Number(o.price))}</span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
              <span aria-hidden className="text-muted-foreground/60 font-bold text-xl flex-shrink-0 pr-1">›</span>
            </button>
          ) : (
            <a
              key={o.id}
              href={consultHref}
              target="_blank"
              rel="noopener noreferrer"
              className="pv2-card p-3 flex items-center gap-3"
            >
              <div className="w-20 aspect-square overflow-hidden rounded-xl flex-shrink-0">
                <ProductImage
                  src={o.image_url || null}
                  name={o.name}
                  category={o.category}
                  vertical={vendor.vertical}
                  alt={o.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="pv2-title text-sm line-clamp-2">{o.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="pv2-chip mr-1"><Puzzle className="h-3 w-3" /> COMBO</span>
                  {incluye ? <><span className="font-semibold">Incluye:</span> {incluye} · </> : null}
                  <span className="pv2-price">{fmt(o.price)}</span>
                </p>
              </div>
            </a>
          );
        })}
      </div>

      {building && (
        <ComboBuilderSheet
          key={building.id}
          combo={{
            id: building.id,
            name: building.name,
            description: building.description ?? null,
            image_url: building.image_url ?? null,
            price: Number(building.price),
            promo_price: building.promo_price != null ? Number(building.promo_price) : null,
            category: building.category ?? null,
          }}
          members={(membersByCombo?.[building.id] || []).map((m) => ({ product_id: m.product_id, name: m.name, qty: m.qty }))}
          variantsBy={(variantsByProduct || {}) as any}
          mode="cart"
          vendor={vendor}
          mods={modifiersByProduct?.[building.id] || []}
          onClose={() => setBuildingId(null)}
        />
      )}

      {selected && !buildingId && (
        <div key={selected.id} className="h-0 overflow-hidden">
          {isModa ? (
            <ProductCard
              product={selected}
              variants={variantsByProduct?.[selected.id] || []}
              images={imagesByProduct?.[selected.id] || []}
              vendor={vendor}
              modifiers={modifiersByProduct?.[selected.id] || []}
              acceptsCart={acceptsCart}
              consultHref={consultHref}
              autoOpen
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <GastroProductRow
              product={selected}
              vendor={vendor}
              modifiers={modifiersByProduct?.[selected.id] || []}
              acceptsCart={acceptsCart}
              consultHref={consultHref}
              images={imagesByProduct?.[selected.id] || []}
              autoOpen
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      )}
    </section>
  );
}
