import { ProductImage } from "@/components/product-image";

/**
 * Pantalla de local cerrado: en vez de dejar la carta dando vueltas (y que el
 * cliente pida algo que no se le puede vender), se muestra una pantalla digna
 * con el horario. Es el "empty state" que separa un cartel profesional de una
 * página estirada.
 */
export function TvClosed({ name, logoUrl, hoursText }: { name: string; logoUrl: string | null; hoursText: string | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-24 text-center">
      {logoUrl && (
        <ProductImage
          src={logoUrl}
          name={name}
          alt={name}
          className="h-32 w-32 rounded-full opacity-80"
          iconClassName="h-16 w-16"
          eager
        />
      )}
      <h2 className="font-bold leading-tight" style={{ fontSize: 92 }}>
        Volvemos en un rato
      </h2>
      <p style={{ fontSize: 40, color: "var(--tv-muted)" }}>
        {hoursText ? `Nuestro horario: ${hoursText}` : "Consultanos por WhatsApp desde nuestro perfil."}
      </p>
    </div>
  );
}
