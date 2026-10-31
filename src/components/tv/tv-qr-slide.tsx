"use client";

import { ProductImage } from "@/components/product-image";

type Props = {
  /** Nombre del comercio (título de la pantalla). */
  name: string;
  logoUrl: string | null;
  /** PNG del QR ya renderizado (dataUrl, server-side). */
  qrDataUrl: string;
  /** Segundos que dura la slide (barra de progreso). */
  durationSec: number;
  /** Anti burn-in: desplazamiento del lienzo. */
  shifted?: boolean;
  /** Texto secundario (la pantalla de cerrado lo cambia a "para retirar"). */
  subtitle?: string;
};

/**
 * Pantalla de QR para pedidos online.
 *
 * Es un corte dentro de la rotación (o el cierre del local): un cartel
 * grande, legible desde la vereda, con el QR al centro para pedir desde el
 * celular. Compone logo + nombre del comercio arriba, la invitación, el QR
 * dominante y el sello de Portal 659 abajo (0% comisión). El fondo usa el
 * mismo sistema visual que el resto de la TV (tema + glow).
 */
export function TvQrSlide({
  name,
  logoUrl,
  qrDataUrl,
  durationSec,
  shifted = false,
  subtitle = "Escaneá y armá tu pedido desde el celular",
}: Props) {
  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center overflow-hidden px-24 text-center"
      style={{
        transform: shifted ? "translate(8px, 8px)" : "translate(-8px, -8px)",
        transition: "transform 2s ease-in-out",
      }}
      aria-label="Pedí online"
    >
      {/* Comercio: logo + nombre. */}
      <div className="flex items-center gap-6">
        {logoUrl && (
          <ProductImage
            src={logoUrl}
            name={name}
            alt={name}
            className="h-24 w-24 flex-shrink-0 rounded-3xl"
            iconClassName="h-12 w-12"
          />
        )}
        <h1
          className="tv-poster-in text-left leading-tight"
          style={{ fontSize: 64, fontWeight: 800, color: "var(--tv-text)" }}
        >
          {name}
        </h1>
      </div>

      {/* Invitación. */}
      <p
        className="tv-poster-in mt-8"
        style={{ fontSize: 92, fontWeight: 900, color: "var(--tv-accent)", letterSpacing: "-0.02em" }}
      >
        Pedí online
      </p>
      <p className="mt-2" style={{ fontSize: 34, color: "var(--tv-muted)" }}>
        {subtitle}
      </p>

      {/* QR dominante: el protagonista de la pantalla. */}
      <div
        className="tv-poster-in mt-10 rounded-[40px] p-8"
        style={{
          background: "#ffffff",
          boxShadow: "0 30px 90px rgba(0,0,0,0.45)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qrDataUrl}
          alt="Código QR para pedir online"
          className="h-[440px] w-[440px]"
          style={{ imageRendering: "pixelated" }}
        />
      </div>

      {/* Sello Portal 659. */}
      <div className="mt-10 flex items-center gap-3 opacity-80">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/Portal659Logo.png" alt="Portal 659" className="h-12 w-auto" />
        <span style={{ fontSize: 26, color: "var(--tv-muted)" }}>0% comisión</span>
      </div>

      {/* Progreso de la slide. */}
      <div className="absolute inset-x-0 bottom-0 px-[6%] pb-[3%]">
        <div
          className="h-[6px] w-full overflow-hidden rounded-full"
          style={{ background: "var(--tv-scrim)" }}
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
