import { ProductImage } from "@/components/product-image";
import { TV_TYPE } from "@/lib/tv-layout";
import type { TvItem } from "@/lib/tv-snapshot";

type Props = {
  hero: TvItem[];
  upsell: { enabled: boolean; text: string; productId: string | null };
  upsellItem: TvItem | null;
};

/**
 * Banner del destacado: ahora es una PIECE de foto a sangre con zoom lento
 * (Ken Burns) y velo degradado, no una caja con una foto cuadrada al lado.
 * Es la pantalla que más vende según los benchmarks de menús digitales: el
 * cliente mira el destacado, no la lista.
 */
export function TvHero({ hero, upsell, upsellItem }: Props) {
  const main = hero[0];
  if (!main) return null;
  const others = hero.slice(1, 3);

  return (
    <section
      className="relative overflow-hidden rounded-[32px]"
      style={{
        height: 320,
        boxShadow: "inset 0 0 0 2px var(--tv-line), 0 18px 44px rgba(0,0,0,0.18)",
      }}
    >
      {/* Foto a sangre con zoom lento. */}
      {main.imageUrl ? (
        <div className="absolute inset-0 overflow-hidden">
          <div className="tv-kenburns h-full w-full">
            <ProductImage
              src={main.imageUrl}
              name={main.name}
              alt={main.name}
              className="h-full w-full object-cover"
              iconClassName="h-24 w-24"
              eager
            />
          </div>
        </div>
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: "var(--tv-card)" }}
        />
      )}

      {/* Velo: garantiza contraste del texto pase lo que pase con la foto. */}
      <div className="absolute inset-0" style={{ background: "var(--tv-scrim-strong)" }} />

      {/* Franja de acento lateral. */}
      <div
        className="absolute inset-y-0 left-0 w-[10px]"
        style={{ background: "var(--tv-accent)" }}
      />

      <div className="relative flex h-full items-center gap-8" style={{ padding: "0 36px 0 44px" }}>
        <div className="min-w-0 flex-1">
          <p
            className="flex items-center gap-3 font-semibold uppercase tracking-[0.3em]"
            style={{ fontSize: 24, color: "var(--tv-accent)" }}
          >
            <span className="inline-block h-[3px] w-10 rounded-full" style={{ background: "var(--tv-accent)" }} />
            Destacado de hoy
          </p>
          <h2
            className="mt-2 font-display font-black leading-[1.05] tracking-tight"
            style={{ fontSize: 66, color: "#FFFFFF" }}
          >
            {main.name}
          </h2>
          {main.desc && (
            <p
              className="mt-2 line-clamp-2 max-w-[760px] leading-snug"
              style={{ fontSize: 28, color: "rgba(255,255,255,0.82)" }}
            >
              {main.desc}
            </p>
          )}
          <div className="mt-4 flex items-center gap-4">
            {main.priceLabel && (
              <span
                className="tv-price-in rounded-2xl px-5 py-2 font-black"
                style={{
                  fontSize: TV_TYPE.price + 14,
                  background: "var(--tv-accent)",
                  color: "var(--tv-accent-ink)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {main.priceLabel}
              </span>
            )}
            {main.oldPriceLabel && (
              <span
                className="rounded-2xl px-4 py-2 line-through"
                style={{ fontSize: 28, color: "rgba(255,255,255,0.6)" }}
              >
                {main.oldPriceLabel}
              </span>
            )}
            {main.badge && (
              <span
                className="rounded-full px-4 py-2 font-bold uppercase tracking-wide"
                style={{ fontSize: 22, background: "rgba(255,255,255,0.16)", color: "#FFFFFF" }}
              >
                {main.badge}
              </span>
            )}
          </div>
        </div>

        {/* Columna derecha: los otros destacados + el upsell. */}
        <div className="flex shrink-0 flex-col items-end gap-3" style={{ maxWidth: 480 }}>
          {others.map((item) => (
            <div
              key={item.id}
              className="flex w-full items-center gap-4 rounded-2xl px-5 py-3"
              style={{
                background: "rgba(255,255,255,0.10)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.16)",
                backdropFilter: "blur(6px)",
              }}
            >
              <span className="min-w-0 flex-1 truncate text-right font-semibold leading-tight" style={{ fontSize: 28, color: "#FFFFFF" }}>
                {item.name}
              </span>
              {item.priceLabel && (
                <span
                  className="font-black tabular-nums"
                  style={{ fontSize: 32, color: "var(--tv-accent)" }}
                >
                  {item.priceLabel}
                </span>
              )}
            </div>
          ))}

          {upsell.enabled && (upsellItem || upsell.text) && (
            <div
              className="flex w-full items-center gap-3 rounded-2xl px-5 py-3"
              style={{ background: "var(--tv-accent)", color: "var(--tv-accent-ink)" }}
            >
              <span className="text-2xl">🔥</span>
              <span className="min-w-0 flex-1 text-left font-bold" style={{ fontSize: 28 }}>
                {upsell.text || "Sumalo a tu pedido"}
              </span>
              {upsellItem?.priceLabel && (
                <span className="font-black tabular-nums" style={{ fontSize: 28 }}>
                  +{upsellItem.priceLabel}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
