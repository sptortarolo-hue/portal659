"use client";

import { useEffect, useState, useRef } from "react";
import { useCart } from "@/lib/cart";
import { ProductImage } from "@/components/product-image";
import { useToast } from "@/lib/toast";
import { ShoppingBag } from "lucide-react";

type Suggestion = {
  id: string;
  name: string;
  price: number;
  promo_price: number | null;
  image: string | null;
  unit: string;
  packSize: number | null;
  cashExcluded: boolean;
  presentationLabel: string | null;
};

export function CartSuggestions() {
  const { vendor, items, addItem } = useCart();
  const { addToast } = useToast();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!vendor?.id) {
      setSuggestions([]);
      fetchedFor.current = null;
      return;
    }
    if (fetchedFor.current === vendor.id) return;
    fetchedFor.current = vendor.id;
    setLoading(true);
    fetch(`/api/store/suggestions?vendorId=${encodeURIComponent(vendor.id)}`)
      .then((r) => (r.ok ? r.json() : { suggestions: [] }))
      .then((d) => setSuggestions(Array.isArray(d?.suggestions) ? d.suggestions : []))
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  }, [vendor?.id]);

  // Filtrar ya agregados y agotados (stock se filtra server-side).
  const inCart = new Set(items.map((i) => i.offerId));
  const visible = suggestions.filter((s) => !inCart.has(s.id)).slice(0, 8);

  if (!vendor || visible.length === 0) return null;

  function handleAdd(s: Suggestion) {
    const switched = addItem(vendor!, {
      offerId: s.id,
      name: s.presentationLabel ? `${s.name} ${s.presentationLabel}`.trim() : s.name,
      price: s.promo_price != null ? s.promo_price : s.price,
      qty: s.packSize && s.packSize >= 2 ? s.packSize : 1,
      image: s.image,
      cashExcluded: s.cashExcluded,
      packSize: s.packSize && s.packSize >= 2 ? s.packSize : undefined,
      unit: s.unit === "kg" ? "kg" : undefined,
    });
    if (switched) {
      addToast("Se limpió el carrito anterior (solo podés pedir de un local a la vez)");
    } else {
      addToast(`${s.name} agregado al carrito`);
    }
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
  }

  return (
    <div className="border-t border-border px-6 py-3 space-y-2 bg-card">
      <p className="pv2-title text-sm">¿Querés agregar algo más?</p>
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
        {visible.map((s) => {
          const price = s.promo_price != null ? s.promo_price : s.price;
          return (
            <div
              key={s.id}
              className="pv2-card snap-start flex-shrink-0 w-28 p-2 space-y-1.5"
            >
              <div className="h-16 w-full rounded-xl overflow-hidden bg-muted flex items-center justify-center">
                {s.image ? (
                  <ProductImage src={s.image} name={s.name} vertical={vendor?.vertical} alt={s.name} className="w-full h-full object-cover" />
                ) : (
                  <ShoppingBag className="pv2-icon-accent h-7 w-7" />
                )}
              </div>
              <p className="text-xs font-medium leading-tight line-clamp-2">{s.name}{s.presentationLabel ? ` ${s.presentationLabel}` : ""}</p>
              <p className="pv2-price">${price.toLocaleString("es-AR")}</p>
              <button
                onClick={() => handleAdd(s)}
                className="pv2-btn pv2-btn-primary w-full py-1.5 text-xs"
              >
                + Agregar
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
