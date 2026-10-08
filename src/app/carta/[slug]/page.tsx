import { queryOne } from "@/lib/db";
import { isStoreOpen } from "@/lib/open-hours";
import { loadCartaData, variantRange } from "@/lib/carta-data";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ProductImage } from "@/components/product-image";
import { ProductCard } from "@/components/store/product-card";
import { GastroProductRow } from "@/components/store/gastro-product-row";
import { CategoryNav } from "@/components/store/category-nav";
import { PromoSection } from "@/components/store/promo-section";
import { WeeklyHours } from "@/components/store/weekly-hours";
import { neighborhoodLabel, verticalSeoName } from "@/lib/json-ld";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/**
 * Carta de mesa (/carta/[slug]): vista solo-lectura del menú/catálogo,
 * pensada para el QR impreso. Sin carrito (el pedido lo levanta el mesero),
 * sin galería/reseñas/packs/turnera.
 *
 * Visibilidad (`vendors.carta_visibility`, default `qr_only`):
 * - `qr_only`: sirve igual sin token, pero con robots noindex, fuera del
 *   sitemap y sin link desde el micrositio. Independiente de `visible`:
 *   funciona aunque el micrositio esté oculto.
 * - `public`: indexable, en sitemap y linkeada desde el micrositio.
 */
async function loadVendor(slug: string) {
  const vendor = await queryOne<any>(`SELECT * FROM vendors WHERE slug = $1 LIMIT 1`, [slug]);
  return vendor ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const vendor = await loadVendor(slug);
  if (!vendor) return {};
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar";
  const isPublic = (vendor as any).carta_visibility === "public";
  return {
    title: `${vendor.store_name} — Carta | Portal 659`,
    description: `Carta de ${vendor.store_name} (${vendor.category || verticalSeoName(vendor.vertical)}). Escaneaste el QR: mirá el menú y el mesero te toma el pedido.`,
    ...(isPublic ? {} : { robots: { index: false, follow: false } }),
    alternates: { canonical: `/carta/${slug}` },
    openGraph: {
      title: `${vendor.store_name} — Carta | Portal 659`,
      description: `Carta de ${vendor.store_name}. El mesero te toma el pedido.`,
      url: `${siteUrl}/carta/${slug}`,
      ...(vendor.logo_url || vendor.image_url ? { images: [vendor.logo_url || vendor.image_url] } : {}),
    },
  };
}

export default async function CartaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vendor = await loadVendor(slug);
  if (!vendor) notFound();
  const v = vendor as any;
  const isPublicCarta = v.carta_visibility === "public";

  const isModa = v.vertical === "moda";
  const isGastro = v.vertical === "gastronomia";
  const isComercio = v.vertical === "comercio";
  const isCatalog = isModa || isComercio;
  const isService = v.vertical === "servicio" || v.vertical === "estetica";

  const data = await loadCartaData(v.id, isCatalog);
  const { sections, promos, modifiersByProduct, variantsByProduct, imagesByProduct, services } = data;

  const open = isStoreOpen({ hours: v.hours ?? null, open_override: v.open_override ?? null });
  const waNumber = (v.whatsapp || "").replace(/[^0-9]/g, "");
  const waUrl = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(`Hola ${v.store_name}! Te consulto por la carta. Vengo de Portal 659.`)}`
    : null;
  // Fallback si el local no cargó WhatsApp: volver al micrositio.
  const consultHref = waUrl ?? `/tienda/${v.slug}`;

  const vendorBrief = {
    id: v.id,
    slug: v.slug,
    storeName: v.store_name,
    whatsapp: v.whatsapp || "",
    vertical: v.vertical,
    deliveryFee: null,
    freeDeliveryMin: null,
    deliveryOptions: v.delivery_options || "ambos",
    deliveryMode: "flat" as const,
    deliveryAreaText: null,
    deliveryZones: [],
    cashDiscountPct:
      String(v.payment_methods || "")
        .split(",")
        .map((s: string) => s.trim())
        .includes("Efectivo") && Number(v.cash_discount_pct) > 0
        ? Number(v.cash_discount_pct)
        : null,
    volumeGroups: [],
  };

  // Vidriera (comercio): grilla visual estilo moda, solo con catálogo simple.
  const wantVidriera = isComercio && v.storefront_layout === "vidriera";
  const hasComplexCatalog = (data.offers || []).some(
    (o: any) =>
      Number(o.pack_size) >= 2 ||
      o.unit === "kg" ||
      (o.has_variants === true &&
        (variantsByProduct[o.id]?.length || 0) > 0 &&
        (modifiersByProduct[o.id]?.length || 0) > 0)
  );
  const useCards = isModa || (wantVidriera && !hasComplexCatalog);

  return (
    <main className="min-h-screen bg-background pb-16">
      <div className="max-w-2xl mx-auto px-4">
        {/* Encabezado mínimo: logo + nombre + estado + WhatsApp */}
        <header className="flex items-center gap-3 pt-6 pb-4 border-b border-border">
          <ProductImage
            src={v.logo_url || v.image_url}
            name={v.store_name}
            alt={v.store_name}
            className="h-14 w-14 rounded-full flex-shrink-0"
            iconClassName="h-7 w-7"
            eager
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Carta</p>
            <h1 className="font-display text-xl font-bold leading-tight truncate">{v.store_name}</h1>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              {open === true && <Badge className="bg-green-600 text-white hover:bg-green-600">Abierto ahora</Badge>}
              {open === false && <Badge variant="secondary">Cerrado ahora</Badge>}
              {v.visible === true && (
                <a href={`/tienda/${v.slug}`} className="text-xs font-medium text-primary hover:underline">
                  Ver tienda
                </a>
              )}
            </div>
          </div>
          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 rounded-xl bg-[#25D366] text-white px-3 py-2 text-sm font-semibold hover:brightness-95"
            >
              WhatsApp
            </a>
          )}
        </header>

        {v.hours && (
          <div className="mt-3">
            <WeeklyHours hours={v.hours} />
          </div>
        )}

        {/* Servicios (verticales servicio/estética): lista simple de lectura */}
        {isService && services.length > 0 && (
          <section className="mt-6">
            <h2 className="font-display text-2xl font-semibold mb-4">Servicios</h2>
            <ul className="space-y-3">
              {services.map((s) => (
                <li key={s.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold leading-tight">{s.name}</p>
                      {s.duration_min != null && (
                        <p className="text-xs text-muted-foreground mt-0.5">⏱ {s.duration_min} min</p>
                      )}
                      {s.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{s.description}</p>
                      )}
                    </div>
                    {s.price != null && (
                      <p className="font-bold text-primary whitespace-nowrap">${s.price.toLocaleString("es-AR")}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Carta / catálogo (solo lectura: acceptsCart siempre false) */}
        <h2 id="menu" className="font-display text-2xl font-semibold mt-6 mb-4 scroll-mt-16">
          {isCatalog ? "Catálogo" : "Menú"}
        </h2>
        {promos.length > 0 && (
          <PromoSection
            items={promos}
            vendor={vendorBrief}
            modifiersByProduct={modifiersByProduct}
            acceptsCart={false}
            consultHref={consultHref}
          />
        )}
        {sections.length === 0 && services.length === 0 ? (
          <p className="text-muted-foreground text-center py-12">
            Este local todavía no cargó {isCatalog ? "su catálogo" : "su menú"}.
          </p>
        ) : (
          <>
            {sections.length > 0 && <CategoryNav sections={sections} catalog={isCatalog} />}
            {sections.map((s, i) => (
              <section key={s.name} id={`seccion-${i}`} className="mb-10 scroll-mt-24">
                <h3 className="font-display text-xl font-semibold mb-4 border-b border-border pb-2">{s.name}</h3>
                <div className={useCards ? "grid grid-cols-2 sm:grid-cols-3 gap-3" : "space-y-3"}>
                  {s.items.map((o: any) => {
                    if (useCards) {
                      return (
                        <div key={o.id} id={`product-${o.id}`} className="scroll-mt-24">
                          <ProductCard
                            product={o}
                            variants={variantsByProduct[o.id] || []}
                            images={imagesByProduct[o.id] || []}
                            vendor={vendorBrief}
                            modifiers={modifiersByProduct[o.id]}
                            acceptsCart={false}
                            consultHref={consultHref}
                          />
                        </div>
                      );
                    }
                    const oVariants = variantsByProduct[o.id] || [];
                    const oImages = imagesByProduct[o.id] || [];
                    const seen = new Set<string>();
                    const oAllImages = [
                      ...(o.image_url ? [{ image_url: o.image_url }] : []),
                      ...oImages,
                    ].filter((im: any) => {
                      const u = im?.image_url;
                      if (!u || seen.has(u)) return false;
                      seen.add(u);
                      return true;
                    });
                    if (oVariants.length > 0) {
                      const range = variantRange(oVariants);
                      const stockControl = o.stock_control !== false;
                      const totalStock = oVariants.reduce((a, vv: any) => a + (vv.stock ?? 0), 0);
                      return (
                        <div
                          key={o.id}
                          id={`product-${o.id}`}
                          className="border border-border rounded-xl p-4 bg-card space-y-3 scroll-mt-24"
                        >
                          <div className="flex items-start gap-3">
                            {oAllImages.length > 0 ? (
                              <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0">
                                <ProductImage src={oAllImages[0].image_url} name={o.name} category={o.category} vertical={v.vertical} alt={o.name} className="w-full h-full object-cover" />
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
                              </div>
                              <p className="font-bold text-primary mt-1">
                                {range.min === range.max
                                  ? `$${range.min.toLocaleString("es-AR")}`
                                  : `$${range.min.toLocaleString("es-AR")} – $${range.max.toLocaleString("es-AR")}`}
                              </p>
                              {o.description && (
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{o.description}</p>
                              )}
                            </div>
                          </div>
                          <div className="border-t pt-3">
                            {stockControl && totalStock <= 0 ? (
                              <p className="text-sm font-medium text-red-600 text-center py-2">Sin stock por el momento</p>
                            ) : waUrl ? (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block rounded-md px-3 py-2 text-sm font-medium text-center bg-primary text-primary-foreground hover:bg-primary/90"
                              >
                                Consultar por WhatsApp
                              </a>
                            ) : null}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={o.id}>
                        <GastroProductRow
                          product={o}
                          vendor={vendorBrief}
                          modifiers={modifiersByProduct[o.id] || []}
                          acceptsCart={false}
                          consultHref={consultHref}
                          images={imagesByProduct[o.id] || []}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        )}

        <footer className="mt-8 border-t border-border pt-4 text-center">
          <p className="text-xs text-muted-foreground">Carta digital · el mesero te toma el pedido</p>
          <p className="text-[10px] text-muted-foreground mt-1">Portal 659 — El centro comercial de tu barrio</p>
        </footer>
      </div>
    </main>
  );
}
