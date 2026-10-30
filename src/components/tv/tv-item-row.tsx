import { ProductImage } from "@/components/product-image";
import { TV_TYPE } from "@/lib/tv-layout";
import type { TvItem } from "@/lib/tv-snapshot";

type Props = {
  item: TvItem;
  photoStyle: "none" | "thumb";
  vertical?: string | null;
};

/**
 * Fila de ítem: foto con marco + nombre (+ descripción) + precio en "chip".
 *
 * El precio deja de ser texto suelto y pasa a una etiqueta con fondo: es lo
 * que el cliente escanea de reojo a 3 metros, así que tiene peso visual.
 * La fila mantiene la altura estimada por el motor de layout (foto 96px).
 */
export function TvItemRow({ item, photoStyle, vertical = "gastronomia" }: Props) {
  return (
    <div
      className={`flex items-start gap-4 ${item.soldOut ? "opacity-45" : ""}`}
      style={{ padding: "9px 0" }}
    >
      {photoStyle === "thumb" && (
        <div className="relative shrink-0" style={{ width: 96, height: 96 }}>
          <div
            className="h-full w-full overflow-hidden rounded-2xl"
            style={{ boxShadow: "0 6px 18px rgba(0,0,0,0.16), inset 0 0 0 1px var(--tv-line)" }}
          >
            <ProductImage
              src={item.imageUrl}
              name={item.name}
              vertical={vertical}
              alt={item.name}
              className="h-full w-full object-cover"
              iconClassName="h-10 w-10"
              eager
            />
          </div>
          {item.badge && (
            <span
              className="absolute left-1.5 top-1.5 rounded-full px-2.5 py-1 font-black uppercase tracking-wide"
              style={{
                fontSize: 18,
                background: "var(--tv-accent)",
                color: "var(--tv-accent-ink)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.22)",
              }}
            >
              {item.badge}
            </span>
          )}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <h4
            className={`min-w-0 flex-1 font-semibold leading-tight ${item.soldOut ? "line-through" : ""}`}
            style={{ fontSize: TV_TYPE.item, lineHeight: 1.1 }}
          >
            {item.name}
          </h4>
          {photoStyle !== "thumb" && item.badge && (
            <span
              className="shrink-0 rounded-full px-3 py-1 font-bold uppercase tracking-wide"
              style={{ fontSize: 22, background: "var(--tv-accent)", color: "var(--tv-accent-ink)" }}
            >
              {item.badge}
            </span>
          )}
        </div>
        {item.desc && (
          <p
            className="mt-1 line-clamp-2 leading-snug"
            style={{ fontSize: TV_TYPE.desc, color: "var(--tv-muted)" }}
          >
            {item.desc}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3" style={{ minWidth: 250 }}>
        {item.oldPriceLabel && (
          <span className="line-through" style={{ fontSize: 26, color: "var(--tv-muted)" }}>
            {item.oldPriceLabel}
          </span>
        )}
        {item.priceLabel && (
          <span
            className="rounded-2xl px-4 font-black leading-[1.05]"
            style={{
              fontSize: TV_TYPE.price,
              background: "var(--tv-price-bg)",
              color: "var(--tv-price-ink)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {item.priceLabel}
          </span>
        )}
      </div>
    </div>
  );
}
