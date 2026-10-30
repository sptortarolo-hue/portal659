import { ProductImage } from "@/components/product-image";

/**
 * Pantalla de local cerrado: en vez de dejar la carta dando vueltas (y que el
 * cliente pida algo que no se le puede vender), se muestra una pantalla digna
 * con el horario. Es el "empty state" que separa un cartel profesional de una
 * página estirada.
 */
export function TvClosed({ name, logoUrl, hoursText }: { name: string; logoUrl: string | null; hoursText: string | null }) {
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-8 overflow-hidden px-24 text-center">
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
              className="h-40 w-40 object-cover"
              iconClassName="h-20 w-20"
              eager
            />
          </div>
        )}
      </div>

      <h2
        className="relative font-display font-black leading-tight tracking-tight"
        style={{ fontSize: 104 }}
      >
        Volvemos en un rato
      </h2>
      <p
        className="relative max-w-[1100px] leading-snug"
        style={{ fontSize: 38, color: "var(--tv-muted)" }}
      >
        {hoursText ? `Nuestro horario: ${hoursText}` : "Consultanos por WhatsApp desde nuestro perfil."}
      </p>

      <span
        className="relative mt-2 rounded-full px-7 py-3 font-semibold"
        style={{ fontSize: 30, background: "var(--tv-card)", color: "var(--tv-muted)", boxShadow: "inset 0 0 0 2px var(--tv-line)" }}
      >
        {name}
      </span>
    </div>
  );
}
