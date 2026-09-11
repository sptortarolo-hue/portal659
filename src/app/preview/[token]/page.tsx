import { notFound } from "next/navigation";
import Link from "next/link";
import { queryOne } from "@/lib/db";
import { isPreviewTokenValid } from "@/lib/preview";
import { PreviewBanner } from "@/components/store/preview-banner";
import { VendorCard } from "@/components/store/vendor-card";
import { PreviewDashboardButton } from "./enter-button";
import { Button } from "@/components/ui/button";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Vista previa — Portal 659",
  robots: { index: false, follow: false },
};

/**
 * Vista previa compartible de un comercio oculto.
 * Solo muestra LA tarjeta (como se vería en la home) + acceso al micrositio
 * en prueba. Nunca lista ni expone otros comercios.
 */
export default async function PreviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const vendor = await queryOne<any>(
    `SELECT * FROM vendors WHERE preview_token = $1 LIMIT 1`,
    [token]
  );
  if (!vendor || !isPreviewTokenValid(vendor, token)) notFound();

  const micrositeUrl = `/tienda/${vendor.slug}?preview=${encodeURIComponent(token)}`;

  return (
    <main className="pb-28 overflow-x-clip">
      <PreviewBanner />
      <div className="container mx-auto px-4 py-8 max-w-md">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground mb-1">
          Vista previa · así se ve en la home
        </p>
        <h1 className="font-display text-2xl font-semibold mb-4">
          {vendor.store_name}
        </h1>
        <div className="w-full max-w-[300px] min-w-0">
          <VendorCard
            id={vendor.id}
            slug={vendor.slug}
            store_name={vendor.store_name}
            image_url={vendor.image_url}
            logo_url={vendor.logo_url}
            description={vendor.description}
            vertical={vendor.vertical}
            hours={vendor.hours}
            open_override={vendor.open_override ?? null}
            href={micrositeUrl}
          />
        </div>
        <Button asChild className="w-full mt-6">
          <Link href={micrositeUrl}>Abrir micrositio en prueba</Link>
        </Button>
        <div className="mt-3">
          <PreviewDashboardButton token={token} />
        </div>
        <p className="text-xs text-muted-foreground text-center mt-3">
          Este link es solo para probar. El comercio aún no es público.
        </p>
      </div>
    </main>
  );
}
