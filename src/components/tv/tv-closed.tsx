import { ProductImage } from "@/components/product-image";

/**
 * Pantalla de local cerrado: en vez de dejar la carta dando vueltas (y que el
 * cliente pida algo que no se le puede vender), se muestra una pantalla digna
 * con el horario. Es el "empty state" que separa un cartel profesional de una
 * página estirada.
 *
 * Si el comercio tiene el QR de pedidos online habilitado, se SUMA a la
 * pantalla (no reemplaza el horario): el local cerrado sigue pudiendo vender
 * para retirar/recibir, así que el QR invita a pedir desde el celular.
 */
export function TvClosed({
  name,
  logoUrl,
  hoursText,
  qrDataUrl,
}: {
  name: string;
  logoUrl: string | null;
  hoursText: string | null;
  /** PNG del QR (dataUrl). null = sin QR (no vende online o está apagado). */
  qrDataUrl?: string | null;
}) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-6 overflow-hidden px-24 text-center">
      {/* Halo del acento detrás del logo: da profundidad sin ruido. */}
      <div
        className="tv-glow-pulse pointer-events-none absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "var(--tv-glow)", filter: "blur(90px)" }}
      />

      <div className="relative">
        {logoUrl && (
          <div
            className="overflow-hidden rounded-[40px]"
            style={{ boxShadow: "0 24px 70px rgba(0,0,0,0.28), inset 0 0 0 3px var(--tv-line)" }}
          >
            <ProductImage
              src={logoUrl}
              name={name}
              alt={name}
              className="h-32 w-32 object-cover"
              iconClassName="h-16 w-16"
              eager
            />
          </div>
        )}
      </div>

      <h2
        className="relative font-display font-black leading-tight tracking-tight"
        style={{ fontSize: 84 }}
      >
        {qrDataUrl ? "Ya puedes pedir online" : "Volvemos en un rato"}
      </h2>
      <p
        className="relative max-w-[1100px] leading-snug"
        style={{ fontSize: 34, color: "var(--tv-muted)" }}
      >
        {hoursText ? `Nuestro horario: ${hoursText}` : "Consultanos por WhatsApp desde nuestro perfil."}
      </p>

      {/* QR para pedir online (suma, no reemplaza). */}
      {qrDataUrl && (
        <div className="relative mt-2 flex items-center gap-10">
          <div
            className="rounded-[32px] p-6"
            style={{ background: "#ffffff", boxShadow: "0 24px 70px rgba(0,0,0,0.4)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt="Código QR para pedir online"
              className="h-[320px] w-[320px]"
              style={{ imageRendering: "pixelated" }}
            />
          </div>
          <div className="text-left">
            <p style={{ fontSize: 52, fontWeight: 900, color: "var(--tv-accent)" }}>Pedí online</p>
            <p className="mt-1 max-w-[380px] leading-snug" style={{ fontSize: 28, color: "var(--tv-muted)" }}>
              Para retirar o recibir en tu casa. Escaneá el código desde el celular.
            </p>
          </div>
        </div>
      )}

      <span
        className="relative mt-2 rounded-full px-7 py-3 font-semibold"
        style={{ fontSize: 30, background: "var(--tv-card)", color: "var(--tv-muted)", boxShadow: "inset 0 0 0 2px var(--tv-line)" }}
      >
        {name}
      </span>
    </div>
  );
}
