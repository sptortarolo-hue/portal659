import { ProductImage } from "@/components/product-image";
import { fmtVence } from "@/lib/gift-card-share";

/**
 * Tarjeta de regalo con diseño propio: logo + nombre del comercio, valor
 * protagonista, código y vigencia. Server-safe (sin hooks): se usa en el
 * micrositio, la ficha pública /g/[code], el panel y la imagen para
 * WhatsApp (versión satori en /api/share/giftcard/[code]).
 */
export function TarjetaRegalo({
  storeName,
  logoUrl,
  amount,
  code,
  expiresAt,
  vertical,
  compact = false,
}: {
  storeName: string;
  logoUrl?: string | null;
  amount: number;
  code: string;
  expiresAt?: string | null;
  vertical?: string | null;
  compact?: boolean;
}) {
  const vence = fmtVence(expiresAt);
  return (
    <div
      className={`relative overflow-hidden rounded-3xl text-white shadow-lg ${
        compact ? "max-w-xs" : "max-w-sm"
      } w-full bg-gradient-to-br from-violet-950 via-purple-900 to-fuchsia-800`}
    >
      {/* brillos decorativos */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 85% 15%, rgba(255,255,255,0.35) 0 60px, transparent 62px), radial-gradient(circle at 10% 90%, rgba(255,255,255,0.18) 0 90px, transparent 92px)",
        }}
      />
      <div className={`relative ${compact ? "p-4" : "p-5"} space-y-3`}>
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full overflow-hidden bg-white/95 shadow flex-shrink-0">
            {logoUrl ? (
              <ProductImage
                src={logoUrl}
                name={storeName}
                vertical={vertical}
                alt={storeName}
                className="h-12 w-12"
              />
            ) : (
              <div className="h-12 w-12 flex items-center justify-center text-2xl">🎁</div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-white/70 font-semibold">
              Tarjeta de regalo
            </p>
            <p className="font-display font-bold leading-tight truncate">{storeName}</p>
          </div>
        </div>
        <div className="text-center py-1">
          <p className={`font-display font-black tabular-nums ${compact ? "text-4xl" : "text-5xl"}`}>
            ${Math.round(Number(amount) || 0).toLocaleString("es-AR")}
          </p>
          <p className="text-xs text-white/70 mt-1">de saldo para usar en el local</p>
        </div>
        <div className="rounded-xl bg-black/25 px-3 py-2.5 text-center">
          <p className="font-mono font-bold tracking-widest text-base">
            {String(code || "").trim().toUpperCase()}
          </p>
          <p className="text-[11px] text-white/70 mt-0.5">
            {vence ? `Válida hasta el ${vence}` : "Sin vencimiento"}
          </p>
        </div>
        {!compact && (
          <p className="text-[11px] text-white/60 text-center">
            Presentá este código al pagar en {storeName}. No es canjeable por efectivo.
          </p>
        )}
      </div>
    </div>
  );
}
