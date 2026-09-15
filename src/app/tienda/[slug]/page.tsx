import { queryOne, queryMany } from "@/lib/db";
import { resolveVendorPlan, vendorSellsOnline } from "@/lib/plans";
import { isStoreOpen } from "@/lib/open-hours";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ProductImage } from "@/components/product-image";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";
import { ReviewForm } from "@/components/reviews/review-form";
import { ReviewList } from "@/components/reviews/review-list";
import { FavoriteButton } from "@/components/favorites/favorite-button";
import { QuoteForm } from "@/components/services/quote-form";
import { BookingForm } from "@/components/services/booking-form";
import { StickyWhatsApp } from "@/components/store/sticky-whatsapp";
import { VariantSelector } from "@/components/store/variant-selector";
import { ProductCard } from "@/components/store/product-card";
import { GastroProductRow } from "@/components/store/gastro-product-row";
import { WhatsAppShareButton } from "@/components/store/whatsapp-share-button";
import { ScrollToMenu } from "@/components/store/scroll-to-menu";
import { ScrollToProduct } from "@/components/store/scroll-to-product";
import { IrAComprarButton } from "@/components/store/ir-a-comprar-button";
import { CategoryNav } from "@/components/store/category-nav";
import { VolumeProgress } from "@/components/store/volume-progress";
import { StickyStoreBar } from "@/components/store/sticky-store-bar";
import { VendorShareButton } from "@/components/store/vendor-share-button";
import { PreviewBanner } from "@/components/store/preview-banner";
import { PreviewSessionSync } from "@/components/store/preview-session-sync";
import { canPreviewVendor, getPreviewActor, isServingPreview } from "@/lib/preview";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/**
 * Carga el comercio: público si `visible = true`; si está oculto, solo en
 * modo prueba para dueño/admin/token válido (`?preview=1` o `?preview=<token>`).
 */
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

  const title = `${vendor.store_name} — Portal 659`;
  const description = vendor.description || `${vendor.store_name} en ${vendor.neighborhood || "tu barrio"}. Pedí por WhatsApp o delivery.`;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar";
  // Tarjeta generada (banner + logo + leyenda) para que WhatsApp la muestre al pegar el link.
  // En preview se propaga el token para que la imagen también salga.
  const previewTokenParam =
    preview && typeof sp?.preview === "string" && sp.preview !== "1"
      ? `?preview=${encodeURIComponent(sp.preview)}`
      : "";
  const shareImage = `${siteUrl}/og/tienda/${slug}.jpg${previewTokenParam}`;

  return {
    title,
    description,
    // El modo prueba nunca se indexa.
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

export default async function TiendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const previewParam = typeof sp?.preview === "string" ? sp.preview : null;
  const { vendor, preview } = await loadVendorForRequest(slug, previewParam);
  if (!vendor) notFound();
  // En preview con token compartible se propaga a sessionStorage para el checkout.
  const previewToken = preview && previewParam && previewParam !== "1" ? previewParam : null;

  const offers = await queryMany<any>(
    `SELECT * FROM products WHERE vendor_id = $1 AND available = true ORDER BY featured_today DESC, name ASC`,
    [vendor.id]
  );

  const planRows = await queryMany<any>(
    `SELECT * FROM plans ORDER BY sort ASC`
  );
  const effectivePlan = resolveVendorPlan(vendor as any, planRows || []);
  const acceptsCart = vendorSellsOnline(vendor as any, planRows || []);
  const planBadge = effectivePlan.plan?.badge ?? null;

  const cats = await queryMany<any>(
    `SELECT * FROM vendor_categories WHERE vendor_id = $1 ORDER BY position ASC`,
    [vendor.id]
  );

  const gallery = await queryMany<any>(
    `SELECT * FROM vendor_gallery WHERE vendor_id = $1 ORDER BY position ASC`,
    [vendor.id]
  );

  const productIds = offers?.map((o: any) => o.id) || [];
  let allModifiers: any[] = [];
  if (productIds.length > 0) {
    try {
      allModifiers = await queryMany<any>(
        `SELECT g.id, g.group_name, g.options, g.required, g.max_selections, g.is_variant,
                l.product_id, l.position
         FROM product_modifier_links l
         JOIN modifier_groups g ON g.id = l.group_id
         WHERE l.product_id = ANY($1)
         ORDER BY g.is_variant DESC, l.position ASC`,
        [productIds]
      );
    } catch {
      try {
        allModifiers = await queryMany<any>(
          `SELECT id, product_id, group_name, options, required, max_selections, position
           FROM product_modifiers
           WHERE product_id = ANY($1)
           ORDER BY position ASC`,
          [productIds]
        );
      } catch {
        allModifiers = [];
      }
    }
  }

  const modifiersByProduct: Record<string, any[]> = {};
  if (allModifiers) {
    for (const mod of allModifiers) {
      if (!modifiersByProduct[mod.product_id]) modifiersByProduct[mod.product_id] = [];
      modifiersByProduct[mod.product_id].push(mod);
    }
  }

  // Variantes (solo si algún producto las tiene — moda / indumentaria)
  const variantProductIds = offers?.filter((o: any) => o.has_variants).map((o: any) => o.id) || [];
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
  if (allVariants) {
    for (const v of allVariants) {
      if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
      variantsByProduct[v.product_id].push(v);
    }
  }

  let allProductImages: any[] = [];
  if (variantProductIds.length > 0) {
    try {
      allProductImages = await queryMany<any>(
        `SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY position ASC`,
        [variantProductIds]
      );
    } catch {
      allProductImages = [];
    }
  }
  const imagesByProduct: Record<string, any[]> = {};
  if (allProductImages) {
    for (const img of allProductImages) {
      if (!imagesByProduct[img.product_id]) imagesByProduct[img.product_id] = [];
      imagesByProduct[img.product_id].push(img);
    }
  }

  // Helper: precio mínimo/máximo entre variantes (considerando promo), y mayor descuento
  function variantRange(vars: any[]) {
    const prices = vars.map((x) => (x.promo != null ? Number(x.promo) : Number(x.price)));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const discounts = vars
      .filter((x) => x.promo != null && Number(x.price) > 0)
      .map((x) => Math.round((1 - Number(x.promo) / Number(x.price)) * 100));
    const best = discounts.length > 0 ? Math.max(...discounts) : null;
    return { min, max, best };
  }

  const v = vendor as any;
  const isModa = v.vertical === "moda";
  const isGastro = v.vertical === "gastronomia";

  const norm = (s: string | null) => (s || "").toLowerCase().trim();
  type Section = { name: string; items: any[] };
  const sections: Section[] = [];
  if (cats && cats.length > 0) {
    const used = new Set<string>();
    for (const c of cats as any[]) {
      const items = offers?.filter((o: any) => norm(o.category) === norm(c.name)) || [];
      if (items.length) {
        sections.push({ name: c.name, items });
        used.add(norm(c.name));
      }
    }
    const leftovers = offers?.filter((o: any) => !used.has(norm(o.category))) || [];
    if (leftovers.length) sections.push({ name: "Otros", items: leftovers });
  } else if (offers?.length) {
    sections.push({ name: isModa ? "Catálogo" : "Menú", items: offers });
  }

  // Precios por volumen (solo gastro): grupos + tramos para badges y espejo.
  // Tolerante a tabla sin migrar.
  let volumeGroups: any[] = [];
  if (isGastro) {
    try {
      const gRows: any[] = await queryMany<any>(
        `SELECT id, name, product_ids, combine_promo, combine_cash, extras_mode
         FROM volume_groups WHERE vendor_id = $1 AND active = true ORDER BY position ASC, created_at ASC`,
        [vendor.id]
      );
      if (gRows && gRows.length > 0) {
        const tRows: any[] = await queryMany<any>(
          `SELECT group_id, min_qty, kind, value FROM volume_tiers WHERE group_id = ANY($1) ORDER BY min_qty ASC`,
          [gRows.map((g: any) => g.id)]
        );
        const tiersByGroup: Record<string, any[]> = {};
        for (const t of tRows || []) {
          if (t.kind !== "fixed_total" && t.kind !== "percent_off") continue;
          (tiersByGroup[t.group_id] ||= []).push({
            minQty: Number(t.min_qty),
            kind: t.kind,
            value: Number(t.value),
          });
        }
        volumeGroups = gRows
          .map((g: any) => ({
            id: g.id,
            name: g.name,
            productIds: Array.isArray(g.product_ids) ? g.product_ids.map(String) : [],
            combinePromo: g.combine_promo === true,
            combineCash: g.combine_cash === true,
            extrasIncluded: g.extras_mode === "included",
            tiers: tiersByGroup[g.id] || [],
          }))
          .filter((g: any) => g.productIds.length > 0 && g.tiers.length > 0);
      }
    } catch {
      volumeGroups = [];
    }
  }

  const isService = v.vertical === "servicio";
  // Solo-contacto (toggle OFF en gastro/moda): se oculta el menú y se muestra
  // la tarjeta de contacto. El resto conserva su vidriera con consultar.
  const hideMenu = !acceptsCart && (isGastro || isModa);
  const vendorBrief = {
    id: v.id,
    slug: v.slug,
    storeName: v.store_name,
    whatsapp: v.whatsapp || "",
    vertical: v.vertical,
    deliveryFee: v.delivery_fee != null ? Number(v.delivery_fee) : null,
    freeDeliveryMin: v.free_delivery_min != null ? Number(v.free_delivery_min) : null,
    cashDiscountPct:
      String(v.payment_methods || "")
        .split(",")
        .map((s: string) => s.trim())
        .includes("Efectivo") && Number(v.cash_discount_pct) > 0
        ? Number(v.cash_discount_pct)
        : null,
    volumeGroups,
  };
  const waNumber = (v.whatsapp || "").replace(/[^0-9]/g, "");
  const waText = isService
    ? `Hola ${v.store_name}! Quiero consultar por tu servicio. Vengo de Portal 659.`
    : `Hola ${v.store_name}! Quiero hacer un pedido. Vengo de Portal 659.`;
  const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`;

  const reviewsInfo = await queryMany<{ rating: number }>(
    `SELECT rating FROM reviews WHERE vendor_id = $1`,
    [v.id]
  );
  const reviewCount = reviewsInfo?.length || 0;
  const avgRating = reviewCount > 0
    ? reviewsInfo!.reduce((s: number, r: any) => s + Number(r.rating), 0) / reviewCount
    : null;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: v.store_name,
    url: `${siteUrl}/tienda/${v.slug}`,
    image: v.image_url || v.logo_url || undefined,
    ...(v.address ? { address: { "@type": "PostalAddress", streetAddress: v.address, addressLocality: "Sicardi, La Plata" } } : {}),
    ...(v.whatsapp ? { telephone: v.whatsapp } : {}),
    ...(avgRating != null ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Number(avgRating.toFixed(1)), reviewCount } } : {}),
    ...(v.instagram ? { sameAs: [v.instagram.startsWith("http") ? v.instagram : `https://instagram.com/${v.instagram.replace("@", "")}`] } : {}),
  };

  return (
    <main className="pb-28 overflow-x-clip">
      {preview && <PreviewBanner />}
      {preview && <PreviewSessionSync vendorId={vendor.id} token={previewToken} />}
      <ScrollToMenu />
      <ScrollToProduct />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Full-width cover */}
      <div className="relative h-56 sm:h-72 w-full">
        {v.image_url ? (
          <ProductImage src={v.image_url} name={v.store_name} vertical={v.vertical} alt={v.store_name} className="w-full h-full object-cover" eager />
        ) : (
          <ProductImage src={null} name={v.store_name} vertical={v.vertical} alt={v.store_name} className="w-full h-full" iconClassName="h-24 w-24" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
      </div>

      {/* Barra de marca fija (solo mobile): aparece al scrollear más allá del header */}
      <StickyStoreBar logoUrl={v.logo_url} storeName={v.store_name} />

      <div className="container mx-auto px-4 max-w-4xl">
        {/* Store info card */}
        <div id="store-header" className="-mt-12 relative z-10 rounded-2xl border border-border bg-card p-6 shadow-lg">
          {/* Mobile: fila logo (izq) + Ir a comprar al extremo opuesto (der), misma altura */}
          <div className="flex sm:hidden items-center justify-between mb-3">
            {v.logo_url ? (
              <ProductImage
                src={v.logo_url}
                name={v.store_name}
                vertical={v.vertical}
                alt={`Logo de ${v.store_name}`}
                className="h-12 w-12 rounded-full border-2 border-white shadow-md"
                eager
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-accent flex items-center justify-center">
                <span className="font-bold text-primary">{v.store_name.charAt(0)}</span>
              </div>
            )}
            {!isService && !isModa && (offers?.length || 0) > 0 && !hideMenu && <IrAComprarButton />}
          </div>

          {/* Desktop: logo sigue arriba como siempre */}
          {v.logo_url && (
            <ProductImage
              src={v.logo_url}
              name={v.store_name}
              vertical={v.vertical}
              alt={`Logo de ${v.store_name}`}
              className="hidden sm:block h-16 w-16 rounded-full border-2 border-white shadow-md mb-3"
              eager
            />
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h1 className="font-display text-3xl font-semibold">
                {v.store_name}
              </h1>
              {planBadge && planBadge !== "Gratuito" && (
                <Badge variant="secondary" className="rounded-full text-[10px]">
                  {planBadge}
                </Badge>
              )}
              {v.verified && (
                <Badge className="rounded-full bg-blue-600/90 text-white text-[10px]">
                  ✓ Verificado
                </Badge>
              )}
              <Badge
                className={`rounded-full text-[10px] ${
                  acceptsCart ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
                }`}
              >
                {acceptsCart ? "🛒 Pedí online" : "💬 Solo contacto"}
              </Badge>
            </div>
            <div className="flex items-center gap-2 ml-auto shrink-0">
              <span className="hidden sm:inline-flex">
                {!isService && !isModa && (offers?.length || 0) > 0 && !hideMenu && <IrAComprarButton />}
              </span>
              <FavoriteButton vendorId={v.id} />
              <WhatsAppShareButton slug={v.slug} storeName={v.store_name} isModa={isModa} />
              <VendorShareButton slug={v.slug} storeName={v.store_name} />
            </div>
          </div>
          {v.description && (
            <p className="text-muted-foreground mt-2">{v.description}</p>
          )}

          {/* Tags */}
          <div className="flex flex-wrap gap-2 mt-4">
            {(() => {
              const openNow = isStoreOpen(v as any);
              return openNow !== null ? (
                <span className={`rounded-full px-3 py-1 text-sm font-medium ${
                  openNow ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                }`}>
                  {openNow ? "🟢 Abierto ahora" : "🔴 Cerrado"}
                </span>
              ) : null;
            })()}
            {v.prep_time_min && (
              <span className="rounded-full bg-primary/10 text-primary px-3 py-1 text-sm font-medium">
                ⏱️ {v.prep_time_min} min
              </span>
            )}
            {v.hours && (
              <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
                🕐 {v.hours}
              </span>
            )}
            {v.address && (
              <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
                📍 {v.address}
              </span>
            )}
            {v.payment_methods && (
              <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
                💳 {v.payment_methods}
              </span>
            )}
            {v.delivery_options && v.delivery_options !== "ambos" && (
              <span className="rounded-full bg-accent px-3 py-1 text-sm text-accent-foreground">
                {v.delivery_options === "retiro" ? "🏠 Solo retiro" : "🛵 Solo delivery"}
              </span>
            )}
            {v.neighborhood && (
              <span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground capitalize">
                📍 {v.neighborhood}
              </span>
            )}
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-3 mt-3">
            {v.phone && (
              <a href={`tel:${v.phone}`} className="text-sm text-primary hover:underline">
                Tel: {v.phone}
              </a>
            )}
            {v.instagram && (
              <a
                href={v.instagram.startsWith("http") ? v.instagram : `https://instagram.com/${v.instagram.replace("@", "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline"
              >
                Instagram
              </a>
            )}
            {v.facebook && (
              <a
                href={v.facebook.startsWith("http") ? v.facebook : `https://facebook.com/${v.facebook}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline"
              >
                Facebook
              </a>
            )}
          </div>
        </div>

        {/* Gallery */}
        {gallery && gallery.length > 0 && (
          <div className="border border-border rounded-2xl p-6 bg-card mt-6">
            <h2 className="font-display text-xl font-semibold mb-4">
              {isService ? "Trabajos realizados" : "Galería"}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {gallery.map((g: any) => (
                <div key={g.id} className="relative aspect-square rounded-xl overflow-hidden group cursor-pointer">
                  <ProductImage src={g.image_url} name={g.caption || v.store_name} vertical={v.vertical} alt={g.caption || ""} className="w-full h-full" imgClassName="transition-transform group-hover:scale-105" />
                  {g.caption && (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent text-white text-xs px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      {g.caption}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Service sections */}
        {isService ? (
          <>
            <div className="border border-border rounded-2xl p-8 text-center bg-card mb-6">
              <h2 className="font-display text-2xl font-semibold mb-2">
                Servicio del barrio
              </h2>
              {v.services_list && (
                <p className="text-muted-foreground max-w-md mx-auto mb-2">
                  {v.services_list}
                </p>
              )}
              {v.service_area && (
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-1">
                  Zona: {v.service_area}
                </p>
              )}
              {v.free_estimate && (
                <p className="text-sm text-primary font-medium max-w-md mx-auto mb-4">
                  Presupuesto sin compromiso
                </p>
              )}
              {!v.services_list && (
                <p className="text-muted-foreground max-w-md mx-auto">
                  Este comercio ofrece un servicio en el barrio. Completá el formulario o escribile por WhatsApp.
                </p>
              )}
            </div>

            {v.accepting_quotes && (
              <div className="border border-border rounded-2xl p-6 bg-card mb-6">
                <h3 className="font-display text-lg font-semibold mb-4">
                  📋 Solicitar presupuesto
                </h3>
                <QuoteForm vendorId={v.id} vendorName={v.store_name} servicesList={v.services_list} />
              </div>
            )}

            <div className="border border-border rounded-2xl p-6 bg-card mb-6">
              <h3 className="font-display text-lg font-semibold mb-4">
                📅 Reservar turno
              </h3>
              <BookingForm vendorId={v.id} vendorName={v.store_name} services={offers?.map((o: any) => ({ id: o.id, name: o.name }))} />
            </div>
          </>
        ) : hideMenu ? (
          <>
            {/* Solo contacto: sin menú, tarjeta de contacto directa */}
            <div className="border border-border rounded-2xl p-8 text-center bg-card mt-6 mb-6">
              <h2 className="font-display text-2xl font-semibold mb-2">
                Contactanos directo
              </h2>
              <p className="text-muted-foreground max-w-md mx-auto mb-2">
                {v.description || "Este local atiende por WhatsApp. Escribinos y te respondemos a la brevedad."}
              </p>
              {v.hours && (
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-1">
                  🕒 {v.hours}
                </p>
              )}
              {v.address && (
                <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
                  📍 {v.address}
                </p>
              )}
              {waNumber ? (
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-green-500 text-white px-6 py-3 text-sm font-bold hover:bg-green-600 transition-colors"
                >
                  💬 Escribir por WhatsApp
                </a>
              ) : (
                <p className="text-sm text-muted-foreground">Tel: {v.phone || v.whatsapp || "—"}</p>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Menu sections */}
            <h2 id="menu" className="font-display text-2xl font-semibold mt-6 mb-4 scroll-mt-[152px] sm:scroll-mt-16">{isModa ? "Catálogo" : "Menú"}</h2>
            {sections.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">
                Este local todavía no cargó su menú.
              </p>
            ) : (
              <>
                {sections.length > 0 && <CategoryNav sections={sections} />}
                {isGastro && volumeGroups.length > 0 && <VolumeProgress groups={volumeGroups} />}
                {sections.map((s, i) => (
                  <section key={s.name} id={`seccion-${i}`} className="mb-10 scroll-mt-[184px] sm:scroll-mt-24">
                    <h3 className="font-display text-xl font-semibold mb-4 border-b border-border pb-2">
                      {s.name}
                    </h3>
                    <div className={isModa ? "grid grid-cols-2 sm:grid-cols-3 gap-3" : "space-y-3"}>
                      {s.items.map((o: any) => {
                        if (isModa) {
                          return (
                            <div key={o.id} id={`product-${o.id}`} className="scroll-mt-16 sm:scroll-mt-24">
                              <ProductCard
                                product={o}
                                variants={variantsByProduct[o.id] || []}
                                images={imagesByProduct[o.id] || []}
                                vendor={vendorBrief}
                                modifiers={modifiersByProduct[o.id]}
                                acceptsCart={acceptsCart}
                                consultHref={waUrl}
                              />
                            </div>
                          );
                        }
                        const oVariants = variantsByProduct[o.id] || [];
                        const oImages = imagesByProduct[o.id] || [];
                        if (oVariants.length > 0) {
                          const range = variantRange(oVariants);
                          const totalStock = oVariants.reduce((a, v: any) => a + (v.stock ?? 0), 0);
                          const stockControl = o.stock_control !== false;
                          return (
                            <div
                              key={o.id}
                              id={`product-${o.id}`}
                              className="border border-border rounded-xl p-4 bg-card space-y-3 scroll-mt-16 sm:scroll-mt-24"
                            >
                              <div className="flex items-start gap-3">
                                {oImages.length > 0 ? (
                                  <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0">
                                    <ProductImage src={oImages[0].image_url} name={o.name} category={o.category} vertical={v.vertical} alt={o.name} className="w-full h-full object-cover" />
                                  </div>
                                ) : o.image_url ? (
                                  <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0">
                                    <ProductImage src={o.image_url} name={o.name} category={o.category} vertical={v.vertical} alt={o.name} className="w-full h-full object-cover" />
                                  </div>
                                ) : (
                                  <div className="h-20 w-20 rounded-xl flex items-center justify-center flex-shrink-0 overflow-hidden">
                                    <ProductImage src={null} name={o.name} category={o.category} vertical={v.vertical} alt={o.name} className="w-full h-full" iconClassName="h-8 w-8" />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-semibold leading-tight">{o.name}</p>
                                    {o.featured_today && (
                                      <Badge className="bg-sun text-ink hover:bg-sun">Hoy</Badge>
                                    )}
                                    {oImages.length > 1 && (
                                      <Badge variant="secondary" className="text-[10px]">📷 {oImages.length}</Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    {range.best != null && (
                                      <span className="rounded-full bg-red-500 text-white text-[10px] font-bold px-2 py-0.5">
                                        -{range.best}%
                                      </span>
                                    )}
                                    <p className="font-bold text-primary">
                                      {range.min === range.max
                                        ? `$${range.min.toLocaleString("es-AR")}`
                                        : `$${range.min.toLocaleString("es-AR")} – $${range.max.toLocaleString("es-AR")}`}
                                    </p>
                                  </div>
                                  {o.description && (
                                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{o.description}</p>
                                  )}
                                </div>
                              </div>
                              <div className="border-t pt-3">
                                {stockControl && totalStock <= 0 ? (
                                  <p className="text-sm font-medium text-red-600 text-center py-2">Sin stock por el momento</p>
                                ) : !acceptsCart ? (
                                  <a
                                    href={waUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block rounded-md px-3 py-2 text-sm font-medium text-center bg-primary text-primary-foreground hover:bg-primary/90"
                                  >
                                    Consultar por WhatsApp
                                  </a>
                                ) : (
                                  <VariantSelector
                                    productId={o.id}
                                    name={o.name}
                                    variants={oVariants}
                                    vendor={vendorBrief}
                                    stockControl={o.stock_control !== false}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        }
                        return (
                        <GastroProductRow
                          key={o.id}
                          product={o}
                          vendor={vendorBrief}
                          modifiers={modifiersByProduct[o.id] || []}
                          acceptsCart={acceptsCart}
                          consultHref={waUrl}
                        />
                        );
                      })}
                    </div>
                  </section>
                ))}
              </>
            )}
          </>
        )}

        {/* Reviews */}
        <ReviewList vendorId={v.id} />
        <div className="border border-border rounded-2xl p-6 bg-card mt-6">
          <ReviewForm vendorId={v.id} vendorName={v.store_name} />
        </div>
      </div>

      {/* Sticky WhatsApp CTA: solo sin carrito (gratis) o para servicios */}
      {waNumber && (!acceptsCart || isService) && (
        <StickyWhatsApp
          url={`https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`}
          isService={isService}
          isUrgent={isService && v.urgent_enabled}
          urgentUrl={`https://wa.me/${waNumber}?text=${encodeURIComponent(`🚨 URGENTE - Necesito ${v.store_name} lo antes posible.`)}`}
        />
      )}
    </main>
  );
}
