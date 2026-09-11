"use client";

export type PickProduct = {
  id: string;
  name: string;
  price: number;
  promo_price?: number | null;
  image_url?: string | null;
  available?: boolean;
};

/**
 * Ficha de producto para armar pedidos (Mostrador y Mesas comparten diseño).
 */
export function ProductPickCard({
  product,
  hasModifiers,
  onAdd,
}: {
  product: PickProduct;
  hasModifiers: boolean;
  onAdd: () => void;
}) {
  const p = product;
  return (
    <button
      type="button"
      onClick={onAdd}
      className="group text-left rounded-xl border border-border bg-card overflow-hidden hover:border-primary/50 hover:shadow-sm transition-all active:scale-[0.98] min-w-0"
    >
      <div className="relative aspect-square">
        {p.image_url ? (
          <img
            src={p.image_url}
            alt={p.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-secondary to-accent flex items-center justify-center">
            <span className="font-display text-4xl font-bold text-primary/40">
              {p.name.charAt(0)}
            </span>
          </div>
        )}
        {p.available === false && (
          <span className="absolute top-2 left-2 rounded-full bg-red-500 text-white text-[9px] font-bold px-2 py-0.5">
            Agotado
          </span>
        )}
      </div>
      <div className="p-2 min-w-0">
        <p className="text-xs font-medium line-clamp-2 break-words">{p.name}</p>
        <div className="flex items-baseline gap-1 mt-0.5 flex-wrap min-w-0">
          <span className="text-sm font-semibold text-primary tabular-nums">
            ${Number(p.promo_price ?? p.price).toLocaleString("es-AR")}
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
