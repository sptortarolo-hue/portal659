"use client";

import { ProductImage } from "@/components/product-image";
import { TvQrColumn } from "./tv-qr-column";
import type { ColumnSlot } from "@/lib/tv-rotation";
import type { TvPosterRef } from "@/lib/tv-layout";
import type { TvItem } from "@/lib/tv-snapshot";

type Props = {
  /** Columna 9:16: el alto lo da el flex del padre, el ancho lo calcula el player. */
  width: number;
  /**
   * Qué se muestra en la columna:
   * - "hero"   → el destacado del commerce (producto con precio y descripción);
   * - "poster" → un poster publicitario del comercio (imagen o video);
   * - "qr"     → el QR de "Pedí online" (plantilla vertical).
   * Alternan solos: el player va pasando de uno al otro.
   */
  slot?: ColumnSlot | null;
  /** Poster en escena (solo en modo "poster"). */
  poster?: TvPosterRef | null;
  /** Devuelve el poster por índice (la rotación elige cuál queda en pantalla). */
  posterFor?: (index: number) => TvPosterRef | null;
  /** PNG del QR (dataUrl). null = sin QR en esta pantalla. */
  qrDataUrl?: string | null;
  /** Segundos que dura el slot del QR (barra de progreso). */
  qrSeconds?: number;
  /** Pool de destacados (misma rotación y timer que el banner clásico). */
  hero: TvItem[];
  /** Índice de la oferta que está en escena. */
  index?: number;
  /** Fallback cuando no hay destacados: el logo del comercio. */
  logoUrl: string | null;
  storeName: string;
  upsell: { enabled: boolean; text: string; productId: string | null };
  upsellItem: TvItem | null;
};

/**
 * Columna izquierda del diseño "Split": la pieza 9:16.
 *
 * Es el equivalente vertical del banner clásico: el destacado rota con el MISMO
 * timer y la MISMA selección que el banner (reutiliza `hero`/`index` del player,
 * así no hay una segunda configuración de rotación). Si no hay pool de
 * destacados se muestra el logo del comercio.
 *
 * En modo "poster" la columna muestra un poster publicitario del comercio
 * (imagen o video), alternando con el destacado. Como la columna ES 9:16, un
 * poster vertical entra perfecto: sin recorte y sin franjas negras.
 *
 * Usa la regla híbrida de los posters: la foto entra al MÁXIMO SIN RECORTE
 * (`object-contain` a escala completa) y el blur de la misma imagen completa
 * el resto. Nunca se pierde contenido y nunca quedan franjas negras.
 *
 * El upsell ("Sumalo a tu pedido") se superpone abajo: al ser overlay no
 * descuenta alto de la columna, así el cálculo 9:16 no depende del contenido.
 */
export function TvSplitStage({
  width,
  slot = { kind: "hero", index: 0 },
  poster = null,
  posterFor,
  qrDataUrl = null,
  qrSeconds = 12,
  hero,
  index = 0,
  logoUrl,
  storeName,
  upsell,
  upsellItem,
}: Props) {
  const activeSlot = slot ?? { kind: "hero" as const, index: 0 };
  const mode = activeSlot.kind;
  // El poster en escena lo elige la rotación (por índice).
  const activePoster = activeSlot.kind === "poster" ? posterFor?.(activeSlot.index) ?? poster : poster;
  const main = hero.length ? hero[index % hero.length] : null;
  const isPoster = mode === "poster" && !!activePoster;
  const isQr = mode === "qr" && !!qrDataUrl;
  const isVideo = isPoster && activePoster?.type === "video";
  // La columna muestra la foto del destacado; sin foto (o sin pool) cae al logo.
  const src = isPoster ? activePoster!.url : main?.imageUrl || logoUrl;
  // Para los <video> el src no puede ser null (el bloque solo se dibuja si hay medio).
  const mediaSrc = src ?? "";
  const showUpsell = !isPoster && upsell.enabled && (upsellItem || upsell.text);
  // En modo poster no hay pie de producto: el poster ya trae su propio texto.
  const showFoot = !isPoster && !!main;

  /** Medio (imagen o video) al máximo, sin recorte. */
  const media = isVideo ? (
    <video
      key={`fg-${mediaSrc}`}
      src={mediaSrc}
      autoPlay
      muted
      loop
      playsInline
      className="tv-poster-in h-full w-full object-contain"
    />
  ) : (
    <ProductImage
      src={src}
      name={storeName}
      alt={isPoster ? "Poster" : main?.name ?? storeName}
      fit="contain"
      className="tv-poster-in h-full w-full"
      iconClassName="h-24 w-24"
      eager
    />
  );

  /** Fondo desenfocado: la MISMA imagen cubriendo todo el 9:16. */
  const backdrop = isVideo ? (
    <video
      key={`bg-${mediaSrc}`}
      src={mediaSrc}
      autoPlay
      muted
      loop
      playsInline
      aria-hidden
      className="h-full w-full object-cover"
    />
  ) : (
    <ProductImage
      src={src}
      name={storeName}
      alt=""
      className="h-full w-full object-cover"
      iconClassName="h-24 w-24"
      eager
    />
  );

  return (
    <section
      className="relative shrink-0 overflow-hidden rounded-[32px]"
      style={{
        width,
        boxShadow: "inset 0 0 0 2px var(--tv-line), 0 18px 44px rgba(0,0,0,0.18)",
        background: "var(--tv-card)",
      }}
      aria-label={isQr ? "Pedí online" : isPoster ? "Poster" : "Destacado"}
    >
      {/* Slot del QR: la columna entera es la plantilla vertical de "Pedí
          online". No lleva foto de fondo: el QR es el protagonista y tiene
          que leerse al instante. */}
      {isQr && qrDataUrl ? (
        <TvQrColumn
          name={storeName}
          qrDataUrl={qrDataUrl}
          durationSec={qrSeconds}
          width={width}
        />
      ) : (
        <>
      {/* Fondo desenfocado: la MISMA imagen cubriendo todo el 9:16. */}
      {src && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden>
          <div
            className="h-full w-full"
            style={{ filter: "blur(44px) saturate(1.15)", transform: "scale(1.25)", opacity: 0.55 }}
          >
            {backdrop}
          </div>
        </div>
      )}

      {/* Velo: contraste del texto pase lo que pase con la foto. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(0,0,0,0.10) 34%, rgba(0,0,0,0.55) 72%, rgba(0,0,0,0.88) 100%)",
        }}
      />

      {/* Franja de acento lateral (mismo lenguaje que el banner clásico). */}
      <div className="absolute inset-y-0 left-0 w-[10px]" style={{ background: "var(--tv-accent)" }} />

      {/* Medio a escala máxima, sin recorte: toca el borde en el eje que
          cuelga y el blur completa el resto. Sin Ken Burns a propósito: un
          zoom recortaría la foto y acá la regla es no recortar nunca. */}
      <div className="absolute inset-0" key={`fg-${src ?? "none"}`}>
        {src ? (
          media
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-display text-[160px] font-black" style={{ color: "var(--tv-accent)" }}>
              {storeName.trim().charAt(0).toUpperCase() || "•"}
            </span>
          </div>
        )}
      </div>

      {/* Etiqueta + puntos de rotación: avisa que hay más destacados.
          Van sobre un velo propio (no sobre la foto): con fotos claras la
          etiqueta se perdía contra el fondo. */}
      <div className="absolute left-6 right-6 top-6 flex items-center gap-3">
        {(main || isPoster) && (
          <p
            className="flex items-center gap-2 rounded-full px-3 py-1.5 font-semibold uppercase tracking-[0.28em]"
            style={{
              fontSize: 20,
              color: "var(--tv-accent)",
              background: "rgba(0,0,0,0.45)",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
            }}
          >
            <span className="inline-block h-[3px] w-8 rounded-full" style={{ background: "var(--tv-accent)" }} />
            {isPoster ? "Promo" : "Destacado"}
          </p>
        )}
        {!isPoster && hero.length > 1 && (
          <div className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-2" style={{ background: "rgba(0,0,0,0.45)" }}>
            {hero.slice(0, 6).map((it, i) => (
              <span
                key={it.id}
                className="rounded-full transition-all"
                style={{
                  width: i === index % hero.length ? 18 : 7,
                  height: 7,
                  background: i === index % hero.length ? "var(--tv-accent)" : "rgba(255,255,255,0.75)",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Pie: nombre + precio del destacado, con el upsell debajo. */}
      {showFoot && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3" style={{ padding: "0 26px 26px 34px" }}>
          <div className="tv-hero-enter" key={`txt-${main.id}`}>
            <h2
              className="font-display font-black leading-[1.05] tracking-tight"
              style={{ fontSize: 46, color: "#FFFFFF" }}
            >
              {main.name}
            </h2>
            {main.desc && (
              <p
                className="mt-1.5 line-clamp-2 leading-snug"
                style={{ fontSize: 25, color: "rgba(255,255,255,0.8)" }}
              >
                {main.desc}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {main.priceLabel && (
                <span
                  className="rounded-2xl px-4 py-1.5 font-black"
                  style={{
                    fontSize: 38,
                    background: "var(--tv-accent)",
                    color: "var(--tv-accent-ink)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {main.priceLabel}
                </span>
              )}
              {main.oldPriceLabel && (
                <span className="line-through" style={{ fontSize: 26, color: "rgba(255,255,255,0.6)" }}>
                  {main.oldPriceLabel}
                </span>
              )}
              {main.badge && (
                <span
                  className="rounded-full px-3 py-1 font-bold uppercase tracking-wide"
                  style={{ fontSize: 21, background: "rgba(255,255,255,0.18)", color: "#FFFFFF" }}
                >
                  {main.badge}
                </span>
              )}
            </div>
          </div>

          {showUpsell && (
            <div
              className="flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: "var(--tv-accent)", color: "var(--tv-accent-ink)" }}
            >
              <span className="text-2xl">🔥</span>
              <span className="min-w-0 flex-1 truncate font-bold" style={{ fontSize: 25 }}>
                {upsell.text || "Sumalo a tu pedido"}
              </span>
              {upsellItem?.priceLabel && (
                <span className="font-black tabular-nums" style={{ fontSize: 26 }}>
                  +{upsellItem.priceLabel}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* En modo poster la columna lleva su propia barra de progreso (el pie
          del destacado no está, así que no compite con nada). */}
      {isPoster && activePoster && (
        <div className="absolute inset-x-0 bottom-0" style={{ padding: "0 26px 18px 34px" }}>
          <div className="h-[6px] w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.22)" }}>
            <div
              className="h-full rounded-full"
              style={{
                background: "var(--tv-accent)",
                animation: `tv-progress ${Math.max(1, activePoster.durationSec)}s linear forwards`,
              }}
            />
          </div>
        </div>
      )}
        </>
      )}
    </section>
  );
}
