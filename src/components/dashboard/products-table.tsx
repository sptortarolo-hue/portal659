"use client";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ProductImage } from "@/components/product-image";

type Offer = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category: string | null;
  available: boolean;
  featured_today: boolean;
  image_url: string | null;
  stock: number | null;
  stock_low_threshold: number | null;
  stock_control?: boolean;
  promo_price: number | null;
  requires_prep?: boolean;
  cash_discount_excluded?: boolean;
};

type CostInfo = { cost: number | null; pct: number | null; status: "ok" | "warn" | "bad" | "none" };

/**
 * Tabla densa de productos para escritorio (≥ lg). La vista mobile queda en
 * `OfferList` (cards accordeón) — este componente NO la reemplaza en < lg.
 */
export function ProductsTable({
  offers,
  costByProduct,
  selected,
  onToggleSelect,
  onToggleAll,
  onEdit,
  onToggleFeatured,
  onToggleAvailable,
  onDelete,
}: {
  offers: Offer[];
  costByProduct?: Record<string, CostInfo>;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: (ids: string[]) => void;
  onEdit: (offer: Offer) => void;
  onToggleFeatured: (offer: Offer) => void;
  onToggleAvailable: (offer: Offer) => void;
  onDelete: (offer: Offer) => void;
}) {
  const allIds = offers.map((o) => o.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  return (
    <div className="hidden lg:block overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="w-10 px-3 py-2.5">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary align-middle"
                checked={allSelected}
                onChange={() => onToggleAll(allIds)}
                aria-label="Seleccionar todos"
              />
            </th>
            <th className="px-3 py-2.5 font-medium">Producto</th>
            <th className="w-36 px-3 py-2.5 font-medium">Categoría</th>
            <th className="w-32 px-3 py-2.5 font-medium">Precio</th>
            <th className="w-28 px-3 py-2.5 font-medium">Stock</th>
            <th className="w-24 px-3 py-2.5 font-medium">Costo</th>
            <th className="w-20 px-3 py-2.5 font-medium">Activo</th>
            <th className="w-12 px-3 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => {
            const cost = costByProduct?.[offer.id];
            const lowStock =
              offer.stock_control && offer.stock !== null && offer.stock <= (offer.stock_low_threshold ?? 5);
            return (
              <tr
                key={offer.id}
                onClick={() => onEdit(offer)}
                className="border-b border-border last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
              >
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary align-middle"
                    checked={selected.has(offer.id)}
                    onChange={() => onToggleSelect(offer.id)}
                    aria-label={`Seleccionar ${offer.name}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ProductImage
                      src={offer.image_url}
                      name={offer.name}
                      alt={offer.name}
                      className="h-10 w-10 rounded-lg flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium truncate">{offer.name}</span>
                        {offer.featured_today && (
                          <Badge className="bg-sun/20 text-ink text-[10px] px-1.5 py-0">Hoy</Badge>
                        )}
                        {!offer.available && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            Pausado
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground truncate">{offer.category || "—"}</td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                  {offer.promo_price ? (
                    <>
                      <span className="line-through text-muted-foreground">
                        ${Number(offer.price).toLocaleString("es-AR")}
                      </span>{" "}
                      <span className="text-primary font-medium">
                        ${Number(offer.promo_price).toLocaleString("es-AR")}
                      </span>
                    </>
                  ) : (
                    <>${Number(offer.price).toLocaleString("es-AR")}</>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {!offer.stock_control || offer.stock === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : offer.stock === 0 ? (
                    <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                      Sin stock
                    </Badge>
                  ) : (
                    <span className={lowStock ? "text-red-700 font-medium" : ""}>
                      {offer.stock}
                      {lowStock ? " ⚠️" : ""}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {cost && cost.cost !== null && cost.cost !== undefined ? (
                    <Badge
                      className={`text-[10px] px-1.5 py-0 tabular-nums ${
                        cost.status === "ok"
                          ? "bg-green-100 text-green-700"
                          : cost.status === "warn"
                            ? "bg-amber-100 text-amber-700"
                            : cost.status === "bad"
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-500"
                      }`}
                      title={`Costo ${cost.cost !== null ? `$${Number(cost.cost).toLocaleString("es-AR")}` : "—"}`}
                    >
                      {cost.pct !== null && cost.pct !== undefined
                        ? `${Number(cost.pct).toLocaleString("es-AR")}%`
                        : "Costo"}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <Switch checked={offer.available} onCheckedChange={() => onToggleAvailable(offer)} />
                </td>
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu
                    trigger={<span className="text-xl leading-none">⋯</span>}
                    items={[
                      { label: "Editar", icon: "✏️", onClick: () => onEdit(offer) },
                      {
                        label: offer.featured_today ? "Quitar de Hoy" : "Destacar Hoy",
                        icon: "⭐",
                        onClick: () => onToggleFeatured(offer),
                      },
                      {
                        label: "Eliminar",
                        icon: "🗑️",
                        onClick: () => onDelete(offer),
                        destructive: true,
                      },
                    ]}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
