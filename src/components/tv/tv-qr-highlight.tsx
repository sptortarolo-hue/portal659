"use client";

type Props = {
  /** Nombre del comercio. */
  name: string;
  /** PNG del QR ya renderizado (dataUrl, server-side). */
  qrDataUrl: string;
  /** Segundos que dura (barra de progreso). */
  durationSec: number;
  /** Alto del banner (el mismo que el de destacados: 320px a 1080p). */
  height?: number;
};

/**
 * PLANTILLA DEL QR EN EL DESTACADO (vista clásica).
 *
 * El QR de "Pedí online" entra al banner de destacados como una pieza más de
 * la rotación: a la izquierda el código (grande, con aire para que se escanee
 * desde la vereda) y a la derecha la invitación + el sello de Portal 659.
 *
 * Comparte el lenguaje visual del banner de productos (marco, franja de
 * acento, tipografía display) para que la pantalla no se vea "partida en dos".
 *
 * Los colores salen de los tokens del tema: el banner puede ser claro (tema
 * "barrio") o oscuro (temas de noche) y el texto tiene que leerse en las dos.
 */
export function TvQrHighlight({ name, qrDataUrl, durationSec, height = 320 }: Props) {
  return (
    <section
      className="relative overflow-hidden rounded-[32px]"
      style={{
        height,
        background: "var(--tv-card)",
        boxShadow: "inset 0 0 0 2px var(--tv-line), 0 18px 44px rgba(0,0,0,0.18)",
      }}
      aria-label="Pedí online"
    >
      {/* Halo suave del acento: da profundidad sin robarle atención al QR. */}
      <div
        className="pointer-events-none absolute -right-24 -top-32 h-[420px] w-[420px] rounded-full"
        style={{ background: "var(--tv-glow)", filter: "blur(70px)", opacity: 0.75 }}
        aria-hidden
      />

      {/* Franja de acento lateral (mismo lenguaje que el banner de productos). */}
      <div className="absolute inset-y-0 left-0 w-[10px]" style={{ background: "var(--tv-accent)" }} />

      <div className="relative flex h-full items-center gap-9" style={{ padding: "0 40px 0 48px" }}>
        {/* El QR: protagonista, con aire para escanearlo cómodo. */}
        <div
          className="tv-poster-in shrink-0 rounded-[28px]"
          style={{ background: "#ffffff", padding: 12, boxShadow: "0 18px 46px rgba(0,0,0,0.28)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="Código QR para pedir online"
            className="h-[264px] w-[264px]"
            style={{ imageRendering: "pixelated" }}
          />
        </div>

        {/* Invitación. */}
        <div className="tv-hero-enter min-w-0 flex-1">
          <p
            className="flex items-center gap-3 font-semibold uppercase tracking-[0.3em]"
            style={{ fontSize: 23, color: "var(--tv-fg)" }}
          >
            <span className="inline-block h-[3px] w-10 rounded-full" style={{ background: "var(--tv-accent)" }} />
            Pedí online
          </p>
          <h2
            className="mt-1.5 font-display font-black leading-[1.02] tracking-tight"
            style={{ fontSize: 58, color: "var(--tv-fg)" }}
          >
            Escaneá y armá tu pedido
          </h2>
          <p className="mt-2 max-w-[720px] leading-snug" style={{ fontSize: 28, color: "var(--tv-muted)" }}>
            Desde el celular, sin hacer cola. Pedí en {name} y te lo entregamos.
          </p>
          <div className="mt-4 flex items-center gap-4">
            <span
              className="rounded-full px-4 py-1.5 font-bold uppercase tracking-wide"
              style={{ fontSize: 21, background: "var(--tv-accent)", color: "var(--tv-accent-ink)" }}
            >
              0% comisión
            </span>
            {/* Lockup de texto: el raster del logo tiene mucho padding y a
                este tamaño es ilegible en una TV (y las TVs noHD alegan). */}
            <span
              className="flex items-center gap-2 font-display font-black tracking-tight"
              style={{ fontSize: 26, color: "var(--tv-fg)" }}
            >
              <span
                className="inline-block h-[10px] w-[10px] rounded-full"
                style={{ background: "var(--tv-accent)", boxShadow: "0 0 0 3px var(--tv-card)" }}
              />
              Portal 659
            </span>
          </div>
        </div>
      </div>

      {/* Progreso del slot. */}
      <div className="absolute inset-x-0 bottom-0 px-[3%] pb-[2.5%]">
        <div className="h-[6px] w-full overflow-hidden rounded-full" style={{ background: "var(--tv-scrim)" }}>
          <div
            className="h-full rounded-full"
            style={{
              background: "var(--tv-accent)",
              animation: `tv-progress ${Math.max(1, durationSec)}s linear forwards`,
            }}
          />
        </div>
      </div>
    </section>
  );
}
