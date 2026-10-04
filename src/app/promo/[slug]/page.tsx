import { queryOne, queryMany } from "@/lib/db";
import { queryEffectiveModifiers } from "@/lib/modifier-rules";
import { resolveVendorPlan, vendorSellsOnline } from "@/lib/plans";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ProductImage } from "@/components/product-image";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";
import { StickyWhatsApp } from "@/components/store/sticky-whatsapp";
import { canPreviewVendor, getPreviewActor, isServingPreview } from "@/lib/preview";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

async function loadVendorForRequest(slug: string, previewParam: string | null) {
  const pub = await queryOne<any>(
    `SELECT * FROM vendors WHERE slug = $1 AND visible = true LIMIT 1`,
    [slug]
  );
  if (pub) return { vendor: pub, preview: false };

  const hidden = await queryOne<any>(
    `SELECT * FROM vendors WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  if (!hidden) return { vendor: null, preview: false };

  const actor = await getPreviewActor();
  if (!canPreviewVendor({ vendor: hidden, actor, tokenParam: previewParam })) {
    return { vendor: null, preview: false };
  }
  return { vendor: hidden, preview: isServingPreview(hidden) };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sp = await searchParams;
  const { vendor, preview } = await loadVendorForRequest(
    slug,
    typeof sp?.preview === "string" ? sp.preview : null
  );

  if (!vendor) return {};

  const title = `🔥 Promos en ${vendor.store_name} — Portal 659`;
  const description = vendor.description || `Promos exclusivas en ${vendor.store_name}. Pedí por WhatsApp o delivery.`;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar";
  let versionParam = "";
  try {
    const row = await queryOne<{ updated_at: string }>(
      `SELECT updated_at FROM vendor_promo_images WHERE vendor_id = $1 LIMIT 1`,
      [vendor.id]
    );
    if (row?.updated_at) versionParam = `v=${encodeURIComponent(row.updated_at)}`;
  } catch {
    versionParam = "";
  }
  const previewTokenParam =
    preview && typeof sp?.preview === "string" && sp.preview !== "1"
      ? `preview=${encodeURIComponent(sp.preview)}`
      : "";
  const qs = [versionParam, previewTokenParam].filter(Boolean).join("&");
  const shareImage = `${siteUrl}/og/promo/${slug}.jpg${qs ? `?${qs}` : ""}`;

  return {
    title,
    description,
    ...(preview ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      title,
      description,
      images: [{ url: shareImage, width: 1200, height: 630 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [shareImage],
    },
  };
}

export default async function PromoPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const { vendor, preview } = await loadVendorForRequest(
    slug,
    typeof sp?.preview === "string" ? sp.preview : null
  );

  if (!vendor) notFound();

  const offers = await queryMany<any>(
    `SELECT * FROM products WHERE vendor_id = $1 AND available = true AND (promo_price IS NOT NULL OR promo_only = true) ORDER BY promo_price ASC`,
    [vendor.id]
  );

  const v = vendor as any;
  const isModa = v.vertical === "moda";
  const isGastro = v.vertical === "gastronomia";
  const isComercio = v.vertical === "comercio";
  const isCatalog = isModa || isComercio;

  const promos = (offers || [])
    .filter(
      (o: any) =>
        o.promo_price != null && Number(o.promo_price) > 0 && Number(o.promo_price) < Number(o.price)
    )
    .sort(
      (a: any, b: any) =>
        1 - Number(b.promo_price) / Number(b.price) - (1 - Number(a.promo_price) / Number(a.price))
    );

  const waNumber = v.whatsapp || v.phone;
  const waText = `Hola ${v.store_name}! Vi tus promos en Portal 659. ¿Me contás más?`;
  const consultHref = waNumber
    ? `https://wa.me/${String(waNumber).replace(/\D/g, "")}?text=${encodeURIComponent(waText)}`
    : "#";

  const planRows = await queryMany<any>(`SELECT * FROM plans ORDER BY sort ASC`);
  const acceptsCart = vendorSellsOnline(vendor as any, planRows || []);

  const promoIds = promos.map((o: any) => o.id);
  let allModifiers: any[] = [];
  if (promoIds.length > 0) {
    try {
      allModifiers = await queryEffectiveModifiers(queryMany, promoIds);
    } catch {
      try {
        allModifiers = await queryMany<any>(
          `SELECT id, product_id, group_name, options, required, max_selections, position
           FROM product_modifiers
           WHERE product_id = ANY($1)
           ORDER BY position ASC`,
          [promoIds]
        );
      } catch {
        allModifiers = [];
      }
    }
  }
  const modifiersByProduct: Record<string, any[]> = {};
  for (const mod of allModifiers || []) {
    if (!modifiersByProduct[mod.product_id]) modifiersByProduct[mod.product_id] = [];
    modifiersByProduct[mod.product_id].push(mod);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-red-50 to-white">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <Badge className="bg-red-500 text-white text-lg px-4 py-1 mb-4">
            🔥 Promos
          </Badge>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">{v.store_name}</h1>
          <p className="text-gray-600">{v.description || "Descuentos exclusivos por tiempo limitado"}</p>
        </div>

        {promos.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No hay promos activas en este momento.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {promos.map((o: any) => {
              const pct = Math.round((1 - Number(o.promo_price) / Number(o.price)) * 100);
              return (
                <div
                  key={o.id}
                  className="rounded-2xl border-2 border-red-200 bg-white p-4 flex items-center gap-4 shadow-sm"
                >
                  <div className="h-24 w-24 rounded-xl overflow-hidden flex-shrink-0 bg-gray-100">
                    <ProductImage
                      src={o.image_url || null}
                      name={o.name}
                      category={o.category}
                      vertical={v.vertical}
                      alt={o.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <p className="font-bold leading-snug line-clamp-2 flex-1">{o.name}</p>
                      {pct > 0 && (
                        <span className="text-xs font-bold text-white bg-red-500 rounded-full px-2 py-0.5 whitespace-nowrap flex-shrink-0">
                          −{pct}%
                        </span>
                      )}
                    </div>
                    {o.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-1">{o.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-sm text-gray-400 line-through tabular-nums">
                        ${Number(o.price).toLocaleString("es-AR")}
                      </span>
                      <span className="font-bold text-red-600 tabular-nums">
                        ${Number(o.promo_price).toLocaleString("es-AR")}
                      </span>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {acceptsCart ? (
                      <AddToCartButton
                        offerId={o.id}
                        name={o.name}
                        price={Number(o.promo_price)}
                        vendor={v}
                        modifiers={modifiersByProduct[o.id] || []}
                        cashExcluded={!!o.cash_discount_excluded}
                        origPrice={Number(o.price)}
                        hasPromo
                      />
                    ) : (
                      <a
                        href={consultHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md px-3 py-1.5 text-sm font-medium text-center bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        Consultar
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8 text-center">
          <a
            href={`/tienda/${slug}`}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Ver menú completo
          </a>
        </div>
      </div>

      {waNumber && (
        <StickyWhatsApp
          url={`https://wa.me/${waNumber.replace(/\D/g, "")}?text=${encodeURIComponent(waText)}`}
          isService={false}
          isRetail={isCatalog}
        />
      )}
    </div>
  );
}
