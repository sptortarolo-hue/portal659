import { ProductImage } from "@/components/product-image";
import { TV_TYPE } from "@/lib/tv-layout";
import type { TvItem } from "@/lib/tv-snapshot";

type Props = {
  hero: TvItem[];
  upsell: { enabled: boolean; text: string; productId: string | null };
  upsellItem: TvItem | null;
};

/**
 * Banda fija de arriba: el destacado del día + la zona de upsell
 * ("hacelo combo", "sumá la bebida"). Es la zona que más vende según los
 * benchmarks de menús digitales: se elige el ítem de mayor margen o promo.
 */
export function TvHero({ hero, upsell, upsellItem }: Props) {
  const main = hero[0];
  if (!main) return null;

  return (
    <section
      className="flex items-center gap-8 overflow-hidden rounded-3xl"
      style={{ height: 300, background: "var(--tv-card)", boxShadow: "inset 0 0 0 2px var(--tv-line)" }}
    >
      <div className="shrink-0" style={{ width: 268, height: 268 }}>
        <ProductImage
          src={main.imageUrl}
          name={main.name}
          alt={main.name}
          className="h-full w-full rounded-2xl"
          iconClassName="h-20 w-20"
          eager
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="uppercase tracking-widest" style={{ fontSize: 26, color: "var(--tv-accent)" }}>
          Destacado de hoy
        </p>
        <h2 className="mt-1 font-bold leading-tight" style={{ fontSize: 62 }}>
          {main.name}
        </h2>
        {main.desc && (
          <p className="mt-1 line-clamp-2 leading-snug" style={{ fontSize: 28, color: "var(--tv-muted)" }}>
            {main.desc}
          </p>
        )}
        <div className="mt-3 flex items-center gap-4">
          {main.priceLabel && (
            <span
              className="font-bold"
              style={{
                fontSize: TV_TYPE.price + 16,
                color: "var(--tv-price)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {main.priceLabel}
            </span>
          )}
          {main.oldPriceLabel && (
            <span className="line-through" style={{ fontSize: 30, color: "var(--tv-muted)" }}>
              {main.oldPriceLabel}
            </span>
          )}
        </div>
      </div>

      <div className="mr-8 flex shrink-0 flex-col items-end gap-4" style={{ maxWidth: 460 }}>
        {hero.slice(1, 3).map((item) => (
          <div key={item.id} className="flex items-center gap-3">
            <span className="text-right font-semibold leading-tight" style={{ fontSize: 28 }}>
              {item.name}
            </span>
            {item.priceLabel && (
              <span
                className="font-bold"
                style={{ fontSize: 32, color: "var(--tv-price)", fontVariantNumeric: "tabular-nums" }}
              >
                {item.priceLabel}
              </span>
            )}
          </div>
        ))}

        {upsell.enabled && (upsellItem || upsell.text) && (
          <div
            className="rounded-2xl px-5 py-3 text-right"
            style={{ background: "var(--tv-accent)", color: "var(--tv-accent-ink)" }}
          >
            <p className="font-bold" style={{ fontSize: 30 }}>
              {upsell.text || "Sumalo a tu pedido"}
            </p>
            {upsellItem?.priceLabel && (
              <p style={{ fontSize: 26, fontVariantNumeric: "tabular-nums" }}>+{upsellItem.priceLabel}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
