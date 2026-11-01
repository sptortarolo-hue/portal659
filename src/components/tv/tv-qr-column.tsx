"use client";

type Props = {
  /** Nombre del comercio. */
  name: string;
  /** PNG del QR ya renderizado (dataUrl, server-side). */
  qrDataUrl: string;
  /** Segundos que dura (barra de progreso). */
  durationSec: number;
  /** Ancho de la columna 9:16 (lo calcula el player). */
  width: number;
};

/**
 * PLANTILLA DEL QR EN LA COLUMNA (vista split).
 *
 * La columna 9:16 de la izquierda rota entre el destacado del comercio, sus
 * posters verticales y esta pieza: el QR de "Pedí online". Como la columna ES
 * vertical, el QR se lee de sobra (casi 380px) y entra sin recorte.
 *
 * Va dentro de la columna (no es un takeover): la carta sigue visible al
 * lado, que es justo lo que se quiere cuando el local está abierto — el
 * cliente ve los precios y, al lado, cómo pedir sin hacer cola.
 *
 * Los colores salen de los tokens del tema (`--tv-fg`, `--tv-muted`,
 * `--tv-accent`): la columna puede ser clara (tema "barrio") o oscura
 * (temas de noche), y el texto tiene que leerse en las dos.
 */
export function TvQrColumn({ name, qrDataUrl, durationSec, width }: Props) {
  // El QR se dimensiona con la columna: 78% del ancho, con aire alrededor.
  const qrSize = Math.round(width * 0.78);

  return (
    <div className="absolute inset-0 flex flex-col items-center px-[22px] py-[26px]">
      {/* Halo del acento: da profundidad sin tapar el QR. */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "var(--tv-glow)", filter: "blur(80px)", opacity: 0.6 }}
        aria-hidden
      />

      {/* Arriba: rótulo + nombre del comercio. */}
      <div className="relative z-10 flex w-full flex-col items-center gap-2">
        <span
          className="flex items-center gap-2 rounded-full px-3 py-1.5 font-semibold uppercase tracking-[0.24em]"
          style={{
            fontSize: 19,
            background: "var(--tv-accent)",
            color: "var(--tv-accent-ink)",
          }}
        >
          <span className="inline-block h-[3px] w-7 rounded-full" style={{ background: "var(--tv-accent-ink)" }} />
          Pedí online
        </span>
        <p className="max-w-full truncate text-center font-semibold" style={{ fontSize: 23, color: "var(--tv-muted)" }}>
          {name}
        </p>
      </div>

      {/* Centro: el QR, protagonista de la columna. */}
      <div className="relative z-10 flex flex-1 items-center">
        <div
          className="tv-poster-in rounded-[30px]"
          style={{ background: "#ffffff", padding: 16, boxShadow: "0 18px 46px rgba(0,0,0,0.28)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="Código QR para pedir online"
            style={{ width: qrSize, height: qrSize, imageRendering: "pixelated" }}
          />
        </div>
      </div>

      {/* Abajo: invitación + progreso. */}
      <div className="relative z-10 flex w-full flex-col items-center gap-1.5 pb-3">
        <p
          className="text-center font-display font-black leading-[1.05] tracking-tight"
          style={{ fontSize: 42, color: "var(--tv-fg)" }}
        >
          Escaneá y pedí
        </p>
        <p className="text-center leading-snug" style={{ fontSize: 22, color: "var(--tv-muted)" }}>
          Desde el celular, sin hacer cola
        </p>
        <div className="mt-2 h-[6px] w-full overflow-hidden rounded-full" style={{ background: "var(--tv-scrim)" }}>
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
