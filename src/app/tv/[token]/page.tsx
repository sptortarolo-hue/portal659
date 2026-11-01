import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import {
  ensureShortCode,
  findScreenByToken,
  hasTvScreens,
  screenConnection,
} from "@/lib/tv-data";
import { getSiteUrl } from "@/lib/site-url";
import { TvRemoteButton } from "@/components/tv/tv-remote-button";
import { ProductImage } from "@/components/product-image";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Conectar la tele — Portal 659",
};

/**
 * PÁGINA DEL CELULAR (`/tv/<token>`): a donde cae el escaneo del QR.
 *
 * Antes el QR apuntaba a la carta directamente (que en el celular es el
 * reproductor a pantalla completa, medio inútil). Ahora apunta acá, que es
 * la central de mando:
 *
 *  - "Enviar a la tele": el celular le pide a la tele que muestre esa carta
 *    (el SSE lo empuja: ≤5 segundos).
 *  - El código corto para tipear en la tele (sin escribir 58 caracteres).
 *  - Los pasos para instalar la carta como app en un Android TV.
 */
export default async function TvConnectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ready = await hasTvScreens().catch(() => false);
  if (!ready) notFound();

  const screen = await findScreenByToken(token);
  if (!screen) notFound();

  const vendor = await queryOne<any>(
    `SELECT store_name, logo_url FROM vendors WHERE id = $1 LIMIT 1`,
    [screen.vendor_id]
  ).catch(() => null);
  if (!vendor) notFound();

  const storeName = String(vendor.store_name ?? "").trim() || "Tu comercio";
  const [conn, shortCode] = await Promise.all([
    screenConnection(token),
    ensureShortCode(screen),
  ]);

  const site = getSiteUrl();
  const shortUrl = shortCode ? `${site.replace(/^https?:\/\//, "")}/t/${shortCode}` : null;

  return (
    // Div (no <main>): el layout raíz ya envuelve en <main> y dos <main>
    // anidados son HTML inválido.
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 py-8">
      <header className="flex items-center gap-3">
        <ProductImage
          src={vendor.logo_url ?? null}
          name={storeName}
          alt={storeName}
          className="h-12 w-12 rounded-xl object-cover"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Portal 659</p>
          <h1 className="truncate font-display text-xl font-bold">{storeName}</h1>
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-card p-5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${conn.connected ? "bg-green-500" : "bg-muted-foreground/40"}`}
            aria-hidden
          />
          {conn.connected ? "La tele está conectada" : "La tele no está conectada"}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Mandale tu carta a la tele: el comando llega por el canal de la pantalla y la tele
          cambia sola en los próximos segundos.
        </p>
        <div className="mt-4">
          <TvRemoteButton token={token} connected={conn.connected} />
        </div>
      </section>

      {shortUrl && (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-display text-base font-bold">Para ponerla en la tele</h2>
          <ol className="mt-3 space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <span className="font-bold text-foreground">1.</span>
              <span>
                En la tele, abrí <strong className="text-foreground">Chrome</strong> y entrá a{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] font-semibold text-foreground">
                  {shortUrl}
                </code>
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-foreground">2.</span>
              <span>
                Tocá el menú <strong className="text-foreground">⋮</strong> →{" "}
                <strong className="text-foreground">Instalar app</strong> (en algunos aparatos: “Agregar a
                pantalla de inicio”). Queda un ícono en la tele.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-bold text-foreground">3.</span>
              <span>Listo: desde ese ícono la carta se abre sola y a pantalla completa.</span>
            </li>
          </ol>
          <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
            Si tu tele no tiene Chrome o no aparece la opción de instalar, usá{" "}
            <strong className="text-foreground">Fully Kiosk Browser</strong> (es la última opción): en
            Settings → Start URL pegá <code className="font-mono">{shortUrl}</code>, activá “Kiosk mode” y
            “Keep screen on”.
          </p>
        </section>
      )}

      <a
        href={`/pantalla/${token}`}
        className="text-center text-sm font-semibold text-primary underline-offset-4 hover:underline"
      >
        Ver la carta en el celular →
      </a>
    </div>
  );
}
