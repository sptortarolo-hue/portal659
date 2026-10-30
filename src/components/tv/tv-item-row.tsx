import { ProductImage } from "@/components/product-image";
import { TV_TYPE } from "@/lib/tv-layout";
import type { TvItem } from "@/lib/tv-snapshot";

type Props = {
  item: TvItem;
  photoStyle: "none" | "thumb";
  vertical?: string | null;
};

/**
 * Fila de ítem: foto chica + nombre (+ descripción) + precio a la derecha.
 * Precio siempre con números tabulares y alineado (se comparan de un vistazo).
 */
export function TvItemRow({ item, photoStyle, vertical = "gastronomia" }: Props) {
  return (
    <div className={`flex items-start gap-4 ${item.soldOut ? "opacity-45" : ""}`} style={{ padding: "9px 0" }}>
      {photoStyle === "thumb" && (
        <div className="shrink-0" style={{ width: 96, height: 96 }}>
          <ProductImage
            src={item.imageUrl}
            name={item.name}
            vertical={vertical}
            alt={item.name}
            className="h-full w-full rounded-2xl"
            iconClassName="h-10 w-10"
            eager
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <h4
            className="min-w-0 flex-1 font-semibold leading-tight"
            style={{ fontSize: TV_TYPE.item, lineHeight: 1.1 }}
          >
            {item.name}
          </h4>
          {item.badge && (
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
      <div className="shrink-0 text-right" style={{ minWidth: 260 }}>
        {item.oldPriceLabel && (
          <div className="line-through" style={{ fontSize: 26, color: "var(--tv-muted)" }}>
            {item.oldPriceLabel}
          </div>
        )}
        {item.priceLabel && (
          <div
            className="font-bold"
            style={{ fontSize: TV_TYPE.price, color: "var(--tv-price)", fontVariantNumeric: "tabular-nums" }}
          >
            {item.priceLabel}
          </div>
        )}
      </div>
    </div>
  );
}
