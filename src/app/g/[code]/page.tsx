import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { TarjetaRegalo } from "@/components/store/tarjeta-regalo";
import { fmtVence } from "@/lib/gift-card-share";

/**
 * Ficha pública de una tarjeta de regalo: la ve quien recibe el link por
 * WhatsApp (el código es la autorización). Muestra diseño + saldo +
 * vigencia + cómo canjear. Nunca se indexa (layout con noindex).
 */
export default async function GiftcardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) notFound();

  const card = await queryOne<{
    id: string;
    code: string;
    amount: number;
    balance: number;
    status: string;
    expires_at: string | null;
    vendor_id: string;
  }>(
    `SELECT id, code, amount, balance, status, expires_at::text AS expires_at, vendor_id
     FROM giftcards WHERE code = $1 LIMIT 1`,
    [clean]
  ).catch(() => null);
  if (!card) notFound();

  const vendor = await queryOne<{
    store_name: string;
    slug: string | null;
    logo_url: string | null;
    vertical: string | null;
    whatsapp: string | null;
  }>(
    `SELECT store_name, slug, logo_url, vertical, whatsapp FROM vendors WHERE id = $1 LIMIT 1`,
    [card.vendor_id]
  ).catch(() => null);

  const siteUrl = getSiteUrl();
  const balance = Math.round(Number(card.balance) || 0);
  const amount = Math.round(Number(card.amount) || 0);
  const expired =
    !!card.expires_at && String(card.expires_at).slice(0, 10) < new Date().toISOString().slice(0, 10);
  const usable = card.status === "active" && !expired && balance > 0;
  const waNumber = String(vendor?.whatsapp || "").replace(/[^0-9]/g, "");

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-10 bg-background">
      <div className="w-full max-w-sm space-y-4">
        <TarjetaRegalo
          storeName={vendor?.store_name || "Tu comercio"}
          logoUrl={vendor?.logo_url}
          amount={amount}
          code={card.code}
          expiresAt={card.expires_at}
          vertical={vendor?.vertical}
        />
        <div className="rounded-2xl border border-border bg-card p-4 text-center space-y-1.5">
          {usable ? (
            <>
              <p className="text-sm">
                Saldo disponible: <strong className="tabular-nums">${balance.toLocaleString("es-AR")}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                {card.expires_at
                  ? `Válida hasta el ${fmtVence(card.expires_at)}`
                  : "Sin vencimiento"}
                {" · "}
                Presentá el código al pagar
                {vendor?.store_name ? ` en ${vendor.store_name}` : ""}.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {card.status === "void"
                ? "Esta tarjeta fue anulada."
                : expired
                  ? `Esta tarjeta venció el ${fmtVence(card.expires_at)}.`
                  : "Esta tarjeta ya no tiene saldo."}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {vendor?.slug && (
            <a
              href={`${siteUrl}/tienda/${vendor.slug}`}
              className="block w-full rounded-lg bg-primary text-primary-foreground text-center text-sm font-medium py-2.5 hover:bg-primary/90"
            >
              Ver la tienda de {vendor.store_name}
            </a>
          )}
          {waNumber && (
            <a
              href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Hola ${vendor?.store_name || ""}! Tengo una tarjeta de regalo ${card.code}.`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-lg border border-border text-center text-sm font-medium py-2.5 hover:bg-muted"
            >
              Consultar por WhatsApp
            </a>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground text-center">
          Portal 659 — El centro comercial de tu barrio
        </p>
      </div>
    </main>
  );
}
