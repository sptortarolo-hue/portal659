import { queryOne, queryMany } from "@/lib/db";
import { queryEffectiveModifiers } from "@/lib/modifier-rules";
import { discountOf, promoContentHash } from "@/lib/promo";
import { resolveVendorPlan, vendorSellsOnline } from "@/lib/plans";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { GastroProductRow } from "@/components/store/gastro-product-row";
import { ProductCard } from "@/components/store/product-card";
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
    const row = await queryOne<{
      image_url: string;
      product_ids: unknown;
      updated_at: string;
      mode: unknown;
    }>(
      `SELECT image_url, product_ids, updated_at, mode FROM vendor_promo_images WHERE vendor_id = $1 LIMIT 1`,
      [vendor.id]
    ).catch(() => null);
    const listed = await queryMany<{
      id: string;
      name: string;
      price: number;
      promo_price: number | null;
      image_url: string | null;
    }>(
      `SELECT id, name, price, promo_price, image_url FROM products
       WHERE vendor_id = $1 AND available = true
         AND (promo_price IS NOT NULL OR promo_only = true)`,
      [vendor.id]
    ).catch(() => []);
    const sel = Array.isArray(row?.product_ids)
      ? (row.product_ids as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    const m = row?.mode === "manual" ? "manual" : "auto";
    const hash = promoContentHash(listed || [], sel, m, row?.image_url || null);
    const parts = [hash, row?.updated_at ? String(row.updated_at) : ""].filter(Boolean);
    if (parts.length > 0) versionParam = `v=${encodeURIComponent(parts.join("-"))}`;
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
    // Canonical propio (sin ?preview) para consolidar señales en la URL limpia.
    alternates: { canonical: `/promo/${slug}` },
    openGraph: {
      title,
      description,
      // Canónica OG para que shares de la promo apunten a la URL sin query.
      url: `${siteUrl}/promo/${slug}`,
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

  const listed = (offers || []).filter(
    (o: any) => o.promo_price != null || o.promo_only === true
  );
  const promos = [...listed].sort((a: any, b: any) => discountOf(b) - discountOf(a));

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

  // Variantes (moda: color × talle) y galería para la ficha de producto.
  const variantProductIds = (promos || []).filter((o: any) => o.has_variants).map((o: any) => o.id);
  let allVariants: any[] = [];
  if (variantProductIds.length > 0) {
    try {
      allVariants = await queryMany<any>(
        `SELECT * FROM product_variants WHERE product_id = ANY($1) ORDER BY position ASC`,
        [variantProductIds]
      );
    } catch {
      allVariants = [];
    }
  }
  const variantsByProduct: Record<string, any[]> = {};
  for (const x of allVariants || []) {
    if (!variantsByProduct[x.product_id]) variantsByProduct[x.product_id] = [];
    variantsByProduct[x.product_id].push(x);
  }

  let allProductImages: any[] = [];
  if (promoIds.length > 0) {
    try {
      allProductImages = await queryMany<any>(
        `SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY position ASC`,
        [promoIds]
      );
    } catch {
      allProductImages = [];
    }
  }
  const imagesByProduct: Record<string, any[]> = {};
  for (const img of allProductImages || []) {
    if (!imagesByProduct[img.product_id]) imagesByProduct[img.product_id] = [];
    imagesByProduct[img.product_id].push(img);
  }

  // Brief mínimo para las fichas del store (sin cash/volumen: la landing
  // mantiene paridad de precios con lo que cobraba antes).
  const vendorBrief = {
    id: v.id,
    slug,
    storeName: v.store_name,
    whatsapp: v.whatsapp || "",
    vertical: v.vertical,
  };

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
        ) : isModa ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {promos.map((o: any) => {
              const pct = discountOf(o);
              return (
                <div
                  key={o.id}
                  className="rounded-2xl border-2 border-red-200 bg-white p-2 shadow-sm"
                >
                  <div className="flex items-center gap-1.5 px-1 pb-1.5">
                    <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-2 py-0.5 whitespace-nowrap">
                      {pct > 0 ? `−${pct}%` : "PROMO"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">Tocá para ver detalle</span>
                  </div>
                  <ProductCard
                    product={o}
                    variants={variantsByProduct[o.id] || []}
                    images={imagesByProduct[o.id] || []}
                    vendor={vendorBrief}
                    modifiers={modifiersByProduct[o.id] || []}
                    acceptsCart={acceptsCart}
                    consultHref={consultHref}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid gap-3">
            {promos.map((o: any) => {
              const pct = discountOf(o);
              return (
                <div
                  key={o.id}
                  className="rounded-2xl border-2 border-red-200 bg-white p-2 shadow-sm"
                >
                  <div className="flex items-center gap-1.5 px-1 pb-1.5">
                    <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-2 py-0.5 whitespace-nowrap">
                      {pct > 0 ? `−${pct}%` : "PROMO"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">Tocá para ver detalle</span>
                  </div>
                  <GastroProductRow
                    product={o}
                    vendor={vendorBrief}
                    modifiers={modifiersByProduct[o.id] || []}
                    acceptsCart={acceptsCart}
                    consultHref={consultHref}
                    images={imagesByProduct[o.id] || []}
                  />
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
