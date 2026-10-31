"use client";

import type { TvPosterRef } from "@/lib/tv-layout";

type Props = {
  poster: TvPosterRef;
  /** Segundos que dura el poster (para la barra de progreso). */
  durationSec: number;
  /** Anti burn-in: desplazamiento del lienzo (mismo que el resto de la TV). */
  shifted?: boolean;
};

/**
 * Poster publicitario a PANTALLA COMPLETA.
 *
 * Los posters son un corte publicitario dentro de la carta: cubren todo el
 * lienzo 1920x1080 (header, banner, slides y cinta) como en la señalética
 * digital de un local. El medio va CENTRADO y sin recorte (`object-contain`)
 * sobre un fondo con la MISMA imagen/video reescalada y desenfocada: da
 * profundidad y evita las franjas negras cuando el formato no es 16:9.
 */
export function TvPosterStage({ poster, durationSec, shifted = false }: Props) {
  const isVideo = poster.type === "video";

  return (
    <div
      className="absolute inset-0 z-30 overflow-hidden"
      style={{
        background: "#000",
        transform: shifted ? "translate(8px, 8px)" : "translate(-8px, -8px)",
        transition: "transform 2s ease-in-out",
      }}
      aria-label="Publicidad"
    >
      {/* Fondo desenfocado: la misma imagen/video, reescalada para cubrir. */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="h-full w-full"
          style={{
            filter: "blur(44px) saturate(1.15)",
            transform: "scale(1.25)",
            opacity: 0.5,
          }}
        >
          {isVideo ? (
            <video
              key={`bg-${poster.url}`}
              src={poster.url}
              autoPlay
              muted
              loop
              playsInline
              aria-hidden
              className="h-full w-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`bg-${poster.url}`}
              src={poster.url}
              alt=""
              aria-hidden
              className="h-full w-full object-cover"
            />
          )}
        </div>
      </div>

      {/* Velo: asegura contraste del poster central sobre el fondo. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.72) 100%)",
        }}
      />

      {/* Poster centralizado, sin recorte. */}
      <div className="absolute inset-0 flex items-center justify-center p-[6%]">
        <div
          className="tv-poster-in flex max-h-full max-w-full items-center justify-center overflow-hidden"
          style={{
            borderRadius: 28,
            boxShadow: "0 30px 90px rgba(0,0,0,0.55)",
          }}
        >
          {isVideo ? (
            <video
              key={`fg-${poster.url}`}
              src={poster.url}
              autoPlay
              muted
              loop
              playsInline
              className="max-h-[76vh] max-w-full object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`fg-${poster.url}`}
              src={poster.url}
              alt="Poster"
              className="max-h-[76vh] max-w-full object-contain"
            />
          )}
        </div>
      </div>

      {/* Progreso del poster (la barra de las slides queda tapada por el
          takeover, así que el poster lleva la suya). */}
      <div className="absolute inset-x-0 bottom-0 px-[6%] pb-[4%]">
        <div
          className="h-[8px] w-full overflow-hidden rounded-full"
          style={{ background: "rgba(255,255,255,0.18)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              background: "var(--tv-accent)",
              animation: `tv-progress ${Math.max(1, durationSec)}s linear forwards`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
