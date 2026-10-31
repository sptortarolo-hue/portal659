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
 * Poster publicitario a PANTALLA COMPLETA (modo híbrido).
 *
 * Los posters son un corte publicitario dentro de la carta: cubren todo el
 * lienzo 1920x1080 (header, banner, slides y cinta) como en la señalética
 * digital de un local. El medio va al MÁXIMO SIN RECORTE (`object-contain`
 * a escala completa): toca el borde en el eje que cuelga (un 16:9 llena
 * pantalla entera; un vertical llena el alto) y el fondo con la MISMA
 * imagen/video reescalada y desenfocada completa los espacios sobrantes.
 * Nunca se pierde contenido y nunca quedan franjas negras.
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
            opacity: 0.55,
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
            "radial-gradient(120% 90% at 50% 50%, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.62) 100%)",
        }}
      />

      {/* Medio a escala máxima, sin recorte: toca el borde en el eje que
          cuelga y el blur completa el resto de la pantalla. */}
      {isVideo ? (
        <video
          key={`fg-${poster.url}`}
          src={poster.url}
          autoPlay
          muted
          loop
          playsInline
          className="tv-poster-in absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`fg-${poster.url}`}
          src={poster.url}
          alt="Poster"
          className="tv-poster-in absolute inset-0 h-full w-full object-contain"
        />
      )}

      {/* Progreso del poster (la barra de las slides queda tapada por el
          takeover, así que el poster lleva la suya). */}
      <div className="absolute inset-x-0 bottom-0 px-[6%] pb-[3%]">
        <div
          className="h-[6px] w-full overflow-hidden rounded-full"
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
