import { getSupabase } from "@/lib/supabase";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";
import { CartInlineSummary } from "@/components/cart/cart-inline-summary";
import { ReviewForm } from "@/components/reviews/review-form";
import { ReviewList } from "@/components/reviews/review-list";
import { FavoriteButton } from "@/components/favorites/favorite-button";
import { QuoteForm } from "@/components/services/quote-form";
import { BookingForm } from "@/components/services/booking-form";
import { StickyWhatsApp } from "@/components/store/sticky-whatsapp";
import { VariantSelector } from "@/components/store/variant-selector";
import { ProductCard } from "@/components/store/product-card";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const supabase = getSupabase();
  if (!supabase) return {};

  const { slug } = await params;
  const { data: vendor } = await supabase
    .from("vendors")
    .select("store_name, description, image_url, logo_url, neighborhood, vertical")
    .eq("slug", slug)
    .maybeSingle();

  if (!vendor) return {};

  const title = `${vendor.store_name} — Portal 659`;
  const description = vendor.description || `${vendor.store_name} en ${vendor.neighborhood || "tu barrio"}. Pedí por WhatsApp o delivery.`;
  const imageUrl = vendor.image_url || vendor.logo_url;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: imageUrl ? [{ url: imageUrl, width: 1200, height: 630 }] : undefined,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export default async function TiendaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const supabase = getSupabase();
  if (!supabase) notFound();

  const { slug } = await params;

  const { data: vendor } = await supabase
    .from("vendors")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!vendor) notFound();

  const { data: offers } = await supabase
    .from("products")
    .select("*")
    .eq("vendor_id", vendor.id)
    .eq("available", true)
    .order("featured_today", { ascending: false })
    .order("name", { ascending: true });

  const { data: cats } = await supabase
    .from("vendor_categories")
    .select("*")
    .eq("vendor_id", vendor.id)
    .order("position", { ascending: true });

  const { data: gallery } = await supabase
    .from("vendor_gallery")
    .select("*")
    .eq("vendor_id", vendor.id)
    .order("position", { ascending: true });

  const productIds = offers?.map((o: any) => o.id) || [];
  const { data: allModifiers } = productIds.length > 0
    ? await supabase
        .from("product_modifiers")
        .select("*")
        .in("product_id", productIds)
        .order("position", { ascending: true })
    : { data: null };

const modifiersByProduct: Record<string, any[]> = {};
  if (allModifiers) {
    for (const mod of allModifiers) {
      if (!modifiersByProduct[mod.product_id]) modifiersByProduct[mod.product_id] = [];
      modifiersByProduct[mod.product_id].push(mod);
    }
  }

  // Variantes (solo si algún producto las tiene — moda / indumentaria)
  const variantProductIds = offers?.filter((o: any) => o.has_variants).map((o: any) => o.id) || [];
  const { data: allVariants } = variantProductIds.length > 0
    ? await supabase
        .from("product_variants")
        .select("*")
        .in("product_id", variantProductIds)
        .order("position", { ascending: true })
    : { data: null };
  const variantsByProduct: Record<string, any[]> = {};
  if (allVariants) {
    for (const v of allVariants) {
      if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
      variantsByProduct[v.product_id].push(v);
    }
  }

  const { data: allProductImages } = variantProductIds.length > 0
    ? await supabase
        .from("product_images")
        .select("*")
        .in("product_id", variantProductIds)
        .order("position", { ascending: true })
    : { data: null };
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

  const isService = v.vertical === "servicio";
  const vendorBrief = {
    id: v.id,
    slug: v.slug,
    storeName: v.store_name,
    whatsapp: v.whatsapp || "",
    vertical: v.vertical,
  };
  const waNumber = (v.whatsapp || "").replace(/[^0-9]/g, "");
  const waText = isService
    ? `Hola ${v.store_name}! Quiero consultar por tu servicio.`
    : `Hola ${v.store_name}! Quiero hacer un pedido.`;

  return (
    <main className="pb-28">
      {/* Full-width cover */}
      <div className="relative h-56 sm:h-72 w-full">
        {v.image_url ? (
          <img
            src={v.image_url}
            alt={v.store_name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/20 via-secondary to-accent flex items-center justify-center">
            <span className="font-display text-8xl font-bold text-primary/30">
              {v.store_name.charAt(0)}
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
      </div>

      <div className="container mx-auto px-4 max-w-4xl">
        {/* Store info card */}
        <div className="-mt-12 relative z-10 rounded-2xl border border-border bg-card p-6 shadow-lg">
          {v.logo_url && (
            <img
              src={v.logo_url}
              alt={`Logo de ${v.store_name}`}
              className="h-16 w-16 rounded-full object-cover mb-3 border-2 border-white shadow-md"
            />
          )}
          <div className="flex items-center gap-2">
            <h1 className="font-display text-3xl font-semibold">
              {v.store_name}
            </h1>
            <FavoriteButton vendorId={v.id} />
          </div>
          {v.description && (
            <p className="text-muted-foreground mt-2">{v.description}</p>
          )}

          {/* Tags */}
          <div className="flex flex-wrap gap-2 mt-4">
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
                  <img src={g.image_url} alt={g.caption || ""} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
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
        ) : (
          <>
            {/* Menu sections */}
            <h2 className="font-display text-2xl font-semibold mt-6 mb-4">{isModa ? "Catálogo" : "Menú"}</h2>
            {sections.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">
                Este local todavía no cargó su menú.
              </p>
            ) : (
              <>
                {sections.length > 1 && (
                  <nav className="sticky top-16 z-30 -mx-4 px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border flex gap-2 overflow-x-auto mb-6">
                    {sections.map((s, i) => (
                      <a
                        key={s.name}
                        href={`#seccion-${i}`}
                        className="whitespace-nowrap rounded-full border border-border bg-card px-4 py-1.5 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
                      >
                        {s.name}
                      </a>
                    ))}
                  </nav>
                )}
                {sections.map((s, i) => (
                  <section key={s.name} id={`seccion-${i}`} className="mb-10 scroll-mt-24">
                    <h3 className="font-display text-xl font-semibold mb-4 border-b border-border pb-2">
                      {s.name}
                    </h3>
                    <div className={isModa ? "grid grid-cols-2 sm:grid-cols-3 gap-3" : "space-y-3"}>
                      {s.items.map((o: any) => {
                        if (isModa) {
                          return (
                            <ProductCard
                              key={o.id}
                              product={o}
                              variants={variantsByProduct[o.id] || []}
                              images={imagesByProduct[o.id] || []}
                              vendor={vendorBrief}
                              modifiers={modifiersByProduct[o.id]}
                            />
                          );
                        }
                        const oVariants = variantsByProduct[o.id] || [];
                        const oImages = imagesByProduct[o.id] || [];
                        if (oVariants.length > 0) {
                          const range = variantRange(oVariants);
                          const totalStock = oVariants.reduce((a, v: any) => a + (v.stock ?? 0), 0);
                          return (
                            <div
                              key={o.id}
                              className="border border-border rounded-xl p-4 bg-card space-y-3"
                            >
                              <div className="flex items-start gap-3">
                                {oImages.length > 0 ? (
                                  <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0">
                                    <img src={oImages[0].image_url} alt={o.name} className="w-full h-full object-cover" />
                                  </div>
                                ) : o.image_url ? (
                                  <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0">
                                    <img src={o.image_url} alt={o.name} className="w-full h-full object-cover" />
                                  </div>
                                ) : (
                                  <div className="h-20 w-20 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
                                    <span className="font-display text-3xl font-bold text-primary/50">{o.name.charAt(0)}</span>
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
                                {totalStock <= 0 ? (
                                  <p className="text-sm font-medium text-red-600 text-center py-2">Sin stock por el momento</p>
                                ) : (
                                  <VariantSelector
                                    productId={o.id}
                                    name={o.name}
                                    variants={oVariants}
                                    vendor={vendorBrief}
                                  />
                                )}
                              </div>
                            </div>
                          );
                        }
                        return (
                        <div
                          key={o.id}
                          className="border border-border rounded-xl p-4 bg-card flex items-start justify-between gap-4 hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            {o.image_url ? (
                              <div className="h-20 w-20 rounded-xl overflow-hidden flex-shrink-0">
                                <img
                                  src={o.image_url}
                                  alt={o.name}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ) : (
                              <div className="h-20 w-20 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
                                <span className="font-display text-3xl font-bold text-primary/50">
                                  {o.name.charAt(0)}
                                </span>
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-semibold leading-tight">{o.name}</p>
                                {o.featured_today && (
                                  <Badge className="bg-sun text-ink hover:bg-sun">
                                    Hoy
                                  </Badge>
                                )}
                                {o.stock_low_threshold != null && o.stock != null && o.stock <= 0 && (
                                  <Badge variant="secondary" className="bg-red-100 text-red-700 text-[10px]">Sin stock</Badge>
                                )}
                                {o.stock_low_threshold != null && o.stock != null && o.stock > 0 && o.stock <= o.stock_low_threshold && (
                                  <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-[10px]">¡Últimas!</Badge>
                                )}
                              </div>
                              {o.description && (
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                  {o.description}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            {o.promo_price ? (
                              <div className="text-right">
                                <span className="font-bold text-primary">
                                  ${Number(o.promo_price).toLocaleString("es-AR")}
                                </span>
                                <span className="block text-xs text-muted-foreground line-through">
                                  ${Number(o.price).toLocaleString("es-AR")}
                                </span>
                              </div>
                            ) : (
                              <span className="font-bold">
                                ${Number(o.price).toLocaleString("es-AR")}
                              </span>
                            )}
                            {(!o.stock_low_threshold || o.stock == null || o.stock > 0) && (
                              <AddToCartButton
                                offerId={o.id}
                                name={o.name}
                                price={o.promo_price ? Number(o.promo_price) : Number(o.price)}
                                vendor={vendorBrief}
                                modifiers={modifiersByProduct[o.id]}
                              />
                            )}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
                <CartInlineSummary />
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

      {/* Sticky WhatsApp CTA */}
      {waNumber && (
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
