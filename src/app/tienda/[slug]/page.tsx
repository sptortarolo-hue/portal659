import { queryOne, queryMany } from "@/lib/db";
import { queryEffectiveModifiers } from "@/lib/modifier-rules";
import { getServiceQuota } from "@/lib/service-quota";
import { resolveVendorPlan, vendorSellsOnline } from "@/lib/plans";
import { isStoreOpen } from "@/lib/open-hours";
import { DELIVERY_TZ, deliveryPauseClientMessage, isDeliveryOpen, isDeliveryPaused, nextDeliverySlots } from "@/lib/delivery-schedule";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ProductImage } from "@/components/product-image";
import { AddToCartButton } from "@/components/offers/add-to-cart-button";
import { ReviewForm } from "@/components/reviews/review-form";
import { ReviewList } from "@/components/reviews/review-list";
import { FavoriteButton } from "@/components/favorites/favorite-button";
import { QuoteForm } from "@/components/services/quote-form";
import { BookingForm } from "@/components/services/booking-form";
import { PackBuyCard, GiftcardBuyCard } from "@/components/services/estetica-shop";
import { EsteticaServicesSection } from "@/components/services/service-booking-sheet";
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
import { PackCard } from "@/components/store/pack-card";
import { PromoSection } from "@/components/store/promo-section";
import { PackSheetHost } from "@/components/store/pack-sheet";
import { StoreGallery } from "@/components/store/store-gallery";
import { WeeklyHours } from "@/components/store/weekly-hours";
import { StoreHeader } from "@/components/store/store-header";
import { StickyStoreBar } from "@/components/store/sticky-store-bar";
import { VendorShareButton } from "@/components/store/vendor-share-button";
import { PreviewBanner } from "@/components/store/preview-banner";
import { VisitBeacon } from "@/components/store/visit-beacon";
import { PreviewSessionSync } from "@/components/store/preview-session-sync";
import { canPreviewVendor, getPreviewActor, isServingPreview } from "@/lib/preview";
import { discountOf } from "@/lib/promo";
import { breadcrumbJsonLd, neighborhoodLabel, vendorJsonLd, verticalSeoName } from "@/lib/json-ld";
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

/**
 * Texto de presentación cuando el comercio no cargó descripción: evita la
 * página "fina" (sin texto indexable) usando rubro + barrio, las keywords
 * objetivo ("kiosco Sicardi", "rotisería Garibaldi"). Se usa igual en el
 * meta description y en el cuerpo visible.
 */
function fallbackVendorBlurb(storeName: string, rubro: string, hood: string): string {
  return `${storeName}: ${rubro.toLowerCase()} en ${hood}, La Plata. Mirá el catálogo y pedí online o contactá directo por WhatsApp — 0% comisión.`;
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

  // Título con keywords: "{Nombre} — Rubro en Barrio | Portal 659". El rubro
  // (category del vendor o nombre del vertical) y el barrio son las búsquedas
  // objetivo ("kiosco Sicardi", "rotisería Garibaldi").
  const hood = neighborhoodLabel(vendor.neighborhood) || "tu barrio";
  const rubro = vendor.category || verticalSeoName(vendor.vertical);
  const title = `${vendor.store_name} — ${rubro} en ${hood} | Portal 659`;
  const description =
    vendor.description?.slice(0, 155) ||
    fallbackVendorBlurb(vendor.store_name, rubro, hood);
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
    // Canonical sin ?preview: consolida señales en la URL pública.
    alternates: { canonical: `/tienda/${slug}` },
    openGraph: {
      title,
      description,
      url: `${siteUrl}/tienda/${slug}`,
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
      // Valores efectivos (override por link si existe) con fallback por nivel
      // de migración adentro del helper; legacy solo si no hay tablas nuevas.
      allModifiers = await queryEffectiveModifiers(queryMany, productIds);
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
  // Galería product_images: se carga para TODOS los productos del local
  // (antes solo para los que tenían variantes y los simples perdían su
  // galería aunque existiera). Solo moda la usa hoy; gastro sigue igual
  // porque su rama ya contempla oImages opcional.
  const galleryProductIds = productIds;
  if (galleryProductIds.length > 0) {
    try {
      allProductImages = await queryMany<any>(
        `SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY position ASC`,
        [galleryProductIds]
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
  const isComercio = v.vertical === "comercio";
  // Retail (moda/comercio): se habla de "catálogo" y productos, no de carta/menú.
  const isCatalog = isModa || isComercio;
  // Blurb visible cuando el comercio no cargó descripción (mismo texto del
  // meta description: rubro + barrio como keywords objetivo).
  const storeHood = neighborhoodLabel(v.neighborhood) || "tu barrio";
  const storeRubro = v.category || verticalSeoName(v.vertical);
  const storeBlurb =
    (typeof v.description === "string" && v.description.trim()) ||
    fallbackVendorBlurb(v.store_name, storeRubro, storeHood);
  // Franjas de reparto (retail): el cliente ve cuándo le llega el pedido.
  // Tolerante a migración sin aplicar (delivery_hours llega undefined).
  let retailSlots: { id: string; label: string; range: string; isToday: boolean; isTomorrow: boolean }[] = [];
  let retailDeliveryOpen: boolean | null = null;
  let retailDeliveryPaused = false;
  let retailPauseMsg: string | null = null;
  if (isCatalog) {
    try {
      const sched = {
        hours: (v.hours as string | null) ?? null,
        delivery_hours: (v.delivery_hours as string | null) ?? null,
        open_override: (v.open_override as boolean | null) ?? null,
        delivery_override: (v.delivery_override as boolean | null) ?? null,
        delivery_paused_until: (v.delivery_paused_until as string | null) ?? null,
        delivery_pause_reason: (v.delivery_pause_reason as string | null) ?? null,
        delivery_extra_days: (v.delivery_extra_days as Record<string, { open?: string | null; close?: string | null }>) ?? null,
      };
      retailSlots = nextDeliverySlots(sched, { timeZone: DELIVERY_TZ, count: 3 });
      retailDeliveryOpen = isDeliveryOpen(sched, { timeZone: DELIVERY_TZ });
      retailDeliveryPaused = isDeliveryPaused(sched);
      retailPauseMsg = retailDeliveryPaused ? deliveryPauseClientMessage(sched.delivery_pause_reason) : null;
    } catch {
      retailSlots = [];
      retailDeliveryOpen = null;
    }
  }
  // Precios por volumen (packs combinables): gastronomía y comercios de
  // barrio. El servidor los calcula sin gate vertical; acá se decide si el
  // micrositio los muestra (badges, PackCards, PackSheet).
  const showVolume = isGastro || isComercio;

  const norm = (s: string | null) => (s || "").toLowerCase().trim();
  type Section = { name: string; items: any[] };
  const sections: Section[] = [];
  // Solo-promo: sale en la sección Promo, no en el menú (tolerante a
  // migración sin aplicar: promo_only llega undefined y no excluye).
  const menuOffers = (offers || []).filter((o: any) => o.promo_only !== true);
  // Promo (criterio OR): precio promo o marcado promo_only. Descuentos
  // reales primero, promo_only sin descuento después.
  const promos = (offers || [])
    .filter((o: any) => o.promo_price != null || o.promo_only === true)
    .sort((a: any, b: any) => discountOf(b) - discountOf(a));
  // Packs multi-producto (para CTA + sección). Se calcula tras volumeGroups.
  if (cats && cats.length > 0) {
    const used = new Set<string>();
    for (const c of cats as any[]) {
      const items = menuOffers?.filter((o: any) => norm(o.category) === norm(c.name)) || [];
      if (items.length) {
        sections.push({ name: c.name, items });
        used.add(norm(c.name));
      }
    }
    const leftovers = menuOffers?.filter((o: any) => !used.has(norm(o.category))) || [];
    if (leftovers.length) sections.push({ name: "Otros", items: leftovers });
  } else if (menuOffers?.length) {
    sections.push({ name: isCatalog ? "Catálogo" : "Menú", items: menuOffers });
  }
  // Carta solo-QR: el menú/catálogo solo se ve por QR (/carta). En el
  // micrositio público se ocultan secciones, promos y packs: queda info,
  // contacto y reseñas. En preview se muestra todo para verificar (con
  // aviso en el banner), porque el dueño arma la tienda ahí.
  // Tolerante a migración sin aplicar (undefined = público, como antes).
  const cartaQrOnly = (v.carta_visibility ?? "public") !== "public";
  const menuHidden = cartaQrOnly && !preview;
  if (menuHidden) {
    sections.length = 0;
    promos.length = 0;
  }

  // Precios por volumen (gastro + comercio): grupos + tramos para badges y espejo.
  // Tolerante a tabla sin migrar.
  let volumeGroups: any[] = [];
  // Nombres de productos para comunicar "se combina con" (Fase combinables).
  const nameById = new Map((offers || []).map((o: any) => [String(o.id), String(o.name)]));
  // Detalle para el cartel "Armá tu pack" (foto + precio para quick-add).
  const detailById = new Map(
    (offers || []).map((o: any) => [
      String(o.id),
      { id: String(o.id), name: String(o.name), image: o.image_url || null, price: Number(o.price) || 0 },
    ])
  );
  if (showVolume) {
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
          .map((g: any) => {
            const ids = Array.isArray(g.product_ids) ? g.product_ids.map(String) : [];
            return {
              id: g.id,
              name: g.name,
              productIds: ids,
              combinePromo: g.combine_promo === true,
              combineCash: g.combine_cash === true,
              extrasIncluded: g.extras_mode === "included",
              tiers: tiersByGroup[g.id] || [],
              memberNames: ids.map((id: string) => nameById.get(id)).filter(Boolean),
              members: ids.map((id: string) => detailById.get(id)).filter(Boolean),
            };
          })
          .filter((g: any) => g.productIds.length > 0 && g.tiers.length > 0);
      }
    } catch {
      volumeGroups = [];
    }
  }
  // Packs multi-producto (para CTA + sección).
  const packGroups = (volumeGroups || []).filter(
    (g: any) => (g.productIds || []).length > 1 && (g.tiers || []).length > 0
  );
  // Zonas de reparto propias (modo zones). Tolerante a migración sin aplicar.
  let deliveryZones: { id: string; name: string; description: string | null; fee: number }[] = [];
  if ((v as any).delivery_mode === "zones") {
    try {
      const zrows = await queryMany<any>(
        `SELECT id, name, description, fee FROM delivery_zones
         WHERE vendor_id = $1 AND active = true
         ORDER BY position ASC, created_at ASC LIMIT 3`,
        [v.id]
      );
      deliveryZones = (zrows || []).map((z: any) => ({
        id: String(z.id),
        name: String(z.name ?? ""),
        description: z.description != null ? String(z.description) : null,
        fee: Number(z.fee) || 0,
      }));
    } catch {
      deliveryZones = [];
    }
  }

  const isService = v.vertical === "servicio" || v.vertical === "estetica";
  const isEstetica = v.vertical === "estetica";
  // Catálogo de servicios + profesionales (estética): turnera por servicio
  // con duración y agenda por profesional. Tolerante a migración sin aplicar.
  let esteticaServices: { id: string; name: string; deposit_amount: number | null; duration_min: number | null; price: number | null; require_deposit: boolean | null; deposit_hours: number | null; image_url: string | null; category: string | null; description: string | null }[] = [];
  let esteticaStaff: { id: string; name: string; photo_url: string | null; bio: string | null }[] = [];
  let esteticaLocations: { id: string; name: string; address: string | null }[] = [];
  let esteticaPacks: { id: string; name: string; sessions_total: number | null; price: number | null }[] = [];
  let esteticaMpConnected = false;
  if (isEstetica) {
    try {
      const srows = await queryMany<any>(
        `SELECT id, name, deposit_amount, duration_min, price, require_deposit, deposit_hours, image_url, category, description FROM services WHERE vendor_id = $1 AND active = true ORDER BY position ASC, name ASC`,
        [v.id]
      ).catch(() =>
        queryMany<any>(
          `SELECT id, name, deposit_amount, duration_min, price, require_deposit, deposit_hours, image_url, category FROM services WHERE vendor_id = $1 AND active = true ORDER BY position ASC, name ASC`,
          [v.id]
        ).catch(() => null)
      ).catch(() =>
        queryMany<any>(
          `SELECT id, name, deposit_amount, duration_min, price, require_deposit, deposit_hours FROM services WHERE vendor_id = $1 AND active = true ORDER BY position ASC, name ASC`,
          [v.id]
        ).catch(() => null)
      ).catch(() =>
        queryMany<any>(
          `SELECT id, name, deposit_amount, duration_min, price FROM services WHERE vendor_id = $1 AND active = true ORDER BY position ASC, name ASC`,
          [v.id]
        )
      ).catch(() =>
        queryMany<any>(
          `SELECT id, name, deposit_amount, duration_min FROM services WHERE vendor_id = $1 AND active = true ORDER BY position ASC, name ASC`,
          [v.id]
        )
      );
      esteticaServices = (srows || []).map((s: any) => ({
        id: String(s.id),
        name: String(s.name ?? ""),
        deposit_amount: s.deposit_amount != null ? Number(s.deposit_amount) : null,
        duration_min: s.duration_min != null ? Number(s.duration_min) : null,
        price: s.price != null ? Number(s.price) : null,
        require_deposit: s.require_deposit === true,
        deposit_hours: s.deposit_hours != null ? Number(s.deposit_hours) : null,
        image_url: typeof s.image_url === "string" && s.image_url ? s.image_url : null,
        category: typeof s.category === "string" && s.category.trim() ? s.category.trim() : null,
        description: typeof s.description === "string" && s.description.trim() ? s.description.trim().slice(0, 2000) : null,
      }));
    } catch { esteticaServices = []; }
    try {
      const trows = await queryMany<any>(
        `SELECT id, name, photo_url, bio FROM estetica_staff WHERE vendor_id = $1 AND active = true ORDER BY position ASC, name ASC`,
        [v.id]
      ).catch(() =>
        queryMany<any>(
          `SELECT id, name FROM estetica_staff WHERE vendor_id = $1 AND active = true ORDER BY position ASC, name ASC`,
          [v.id]
        )
      );
      esteticaStaff = (trows || []).map((t: any) => ({
        id: String(t.id),
        name: String(t.name ?? ""),
        photo_url: typeof t.photo_url === "string" && t.photo_url ? t.photo_url : null,
        bio: typeof t.bio === "string" && t.bio.trim() ? t.bio.trim() : null,
      }));
    } catch { esteticaStaff = []; }
    try {
      const lrows = await queryMany<any>(
        `SELECT id, name, address FROM estetica_locations WHERE vendor_id = $1 AND active = true ORDER BY position ASC, name ASC`,
        [v.id]
      );
      esteticaLocations = (lrows || []).map((l: any) => ({ id: String(l.id), name: String(l.name ?? ""), address: l.address != null ? String(l.address) : null }));
    } catch { esteticaLocations = []; }
    try {
      const prows = await queryMany<any>(
        `SELECT id, name, sessions_total, price FROM service_packs WHERE vendor_id = $1 AND active = true ORDER BY name ASC`,
        [v.id]
      );
      esteticaPacks = (prows || []).map((p: any) => ({
        id: String(p.id),
        name: String(p.name ?? ""),
        sessions_total: p.sessions_total != null ? Number(p.sessions_total) : null,
        price: p.price != null ? Number(p.price) : null,
      }));
    } catch { esteticaPacks = []; }
    try {
      const { isMpEnabled } = await import("@/lib/mp-oauth");
      esteticaMpConnected = isMpEnabled() && (v as any).mp_user_id != null;
    } catch { esteticaMpConnected = false; }
  }
  // Tope de solicitudes alcanzado: no se muestran los formularios (el POST
  // devuelve 429 igual). Solo aplica si la migración de tope está aplicada.
  let serviceQuotaFull = false;
  if (isService) {
    try {
      const quota = await getServiceQuota(v.id);
      serviceQuotaFull = quota.limit != null && quota.used >= quota.limit;
    } catch { /* sin migración: se muestran igual */ }
  }
  // Recargo de urgencia (plan Oficios): se muestra solo si el plan lo habilita.
  const urgentSurcharge =
    isService && v.urgent_enabled && v.urgent_surcharge_pct != null && Number(v.urgent_surcharge_pct) > 0 && effectivePlan.can("urgent")
      ? Number(v.urgent_surcharge_pct)
      : null;
  // Venta online apagada (gastro/retail): la carta SIGUE visible pero sin
  // carrito — cada producto muestra "Consultar por WhatsApp". La tarjeta de
  // solo-contacto aparece únicamente cuando todavía no hay carta cargada.
  const noCart = !acceptsCart && (isGastro || isCatalog);
  // Vidriera (comercio): grilla visual estilo moda. Solo si el catálogo es
  // simple (sin packs, sin peso y sin variantes con modificadores — la
  // tarjeta no entiende esos casos); si no, se fuerza lista.
  const wantVidriera = isComercio && (v as any).storefront_layout === "vidriera";
  const hasComplexCatalog = (offers || []).some(
    (o: any) =>
      Number(o.pack_size) >= 2 ||
      o.unit === "kg" ||
      ((o.has_variants === true) &&
        (variantsByProduct[o.id]?.length || 0) > 0 &&
        (modifiersByProduct[o.id]?.length || 0) > 0)
  );
  const useCards = isModa || (wantVidriera && !hasComplexCatalog);
  const vendorBrief = {
    id: v.id,
    slug: v.slug,
    storeName: v.store_name,
    whatsapp: v.whatsapp || "",
    vertical: v.vertical,
    deliveryFee: v.delivery_fee != null ? Number(v.delivery_fee) : null,
    freeDeliveryMin: v.free_delivery_min != null ? Number(v.free_delivery_min) : null,
    deliveryOptions: v.delivery_options || "ambos",
    deliveryMode: ((v as any).delivery_mode === "zones" ? "zones" : "flat") as "flat" | "zones",
    deliveryAreaText: (v as any).delivery_area_text != null ? String((v as any).delivery_area_text) : null,
    deliveryZones,
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
  const hood = neighborhoodLabel(v.neighborhood);
  const jsonLd = [
    // Negocio local: tipo por vertical, dirección real, geo, horarios, rating.
    vendorJsonLd({ siteUrl, vendor: v, avgRating, reviewCount }),
    // Migas de pan (Inicio › rubro › comercio) para el resultado en Google.
    breadcrumbJsonLd([
      { name: "Inicio", url: siteUrl },
      { name: hood ? `${verticalSeoName(v.vertical)} en ${hood}` : "Comercios", url: hood ? `${siteUrl}/buscar?vertical=${encodeURIComponent(v.vertical || "")}` : `${siteUrl}/buscar` },
      { name: v.store_name, url: `${siteUrl}/tienda/${v.slug}` },
    ]),
  ];

  return (
    <main className="pb-28 overflow-x-clip">
      {preview && <PreviewBanner menuQrOnly={cartaQrOnly} catalog={isCatalog} />}
      {!preview && <VisitBeacon vendorId={vendor.id} />}
      {preview && <PreviewSessionSync vendorId={vendor.id} token={previewToken} />}
      <ScrollToMenu />
      <ScrollToProduct />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {/* Store Header: hero con info superpuesta + grid de cards + tags */}
      <StoreHeader
        vendor={v}
        planBadge={planBadge}
        acceptsCart={acceptsCart}
        isService={isService}
        isModa={isModa}
        isCatalog={isCatalog}
        isGastro={isGastro}
        menuHidden={menuHidden}
        offersCount={offers?.length || 0}
        avgRating={avgRating}
        reviewCount={reviewCount}
        storeBlurb={storeBlurb}
        waUrl={waUrl}
        waNumber={waNumber}
        retailSlots={retailSlots}
        retailDeliveryOpen={retailDeliveryOpen}
        retailDeliveryPaused={retailDeliveryPaused}
        retailPauseMsg={retailPauseMsg}
        isEstetica={isEstetica}
        urgentSurcharge={urgentSurcharge}
      />

      {/* Barra de marca fija (solo mobile): aparece al scrollear más allá del header */}
      <StickyStoreBar logoUrl={v.logo_url} storeName={v.store_name} />

      <div className="container mx-auto px-4 max-w-4xl">

        {/* Gallery */}
        {gallery && gallery.length > 0 && (
          <StoreGallery items={gallery} title={isService ? "Trabajos realizados" : "Galería"} />
        )}

        {/* Service sections */}
        {isService ? (
          <>
            <div className="border border-border rounded-2xl p-8 text-center bg-card mb-6">
              <h2 className="font-display text-2xl font-semibold mb-2">
                {isEstetica ? "Estética del barrio" : "Servicio del barrio"}
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
              {isEstetica && esteticaLocations.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5 max-w-md mx-auto mb-2">
                  {esteticaLocations.map((l) => (
                    <span key={l.id} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                      📍 {l.name}{l.address ? ` · ${l.address}` : ""}
                    </span>
                  ))}
                </div>
              )}
              {!isEstetica && v.free_estimate && (
                <p className="text-sm text-primary font-medium max-w-md mx-auto mb-4">
                  Presupuesto sin compromiso
                </p>
              )}
              {!isEstetica && v.urgent_enabled && (
                <p className="text-sm max-w-md mx-auto mb-4 rounded-full bg-red-50 border border-red-200 text-red-700 font-medium px-3 py-1.5 inline-block">
                  🚨 Urgencias 24 h{urgentSurcharge != null ? ` (+${urgentSurcharge} %)` : ""}
                </p>
              )}
              {!isEstetica && !v.services_list && (
                <p className="text-muted-foreground max-w-md mx-auto">
                  Este comercio ofrece un servicio en el barrio. Completá el formulario o escribile por WhatsApp.
                </p>
              )}
            </div>

            {v.accepting_quotes && !serviceQuotaFull && !isEstetica && (
              <div className="border border-border rounded-2xl p-6 bg-card mb-6">
                <h3 className="font-display text-lg font-semibold mb-4">
                  📋 Solicitar presupuesto
                </h3>
                <QuoteForm
                  vendorId={v.id}
                  vendorName={v.store_name}
                  servicesList={v.services_list}
                  estetica={false}
                  prefEnabled={v.quote_pref_enabled !== false}
                  prefDays={Array.isArray(v.quote_days) ? v.quote_days : undefined}
                  prefSlots={Array.isArray(v.quote_slots) ? v.quote_slots : undefined}
                />
              </div>
            )}

            {!serviceQuotaFull && v.bookings_enabled !== false && (
            <div id="reservar-turno" className="border border-border rounded-2xl p-6 bg-card mb-6 scroll-mt-24">
              <h3 className="font-display text-lg font-semibold mb-4">
                📅 Reservar turno
              </h3>
              {isEstetica && esteticaServices.length > 0 && (
                <EsteticaServicesSection
                  services={esteticaServices}
                  vendorId={v.id}
                  vendorName={v.store_name}
                  staffOptions={esteticaStaff.length > 0 ? esteticaStaff : undefined}
                  locationOptions={esteticaLocations.length > 0 ? esteticaLocations : undefined}
                  cancelPolicy={typeof v.cancel_policy_text === "string" && v.cancel_policy_text.trim() ? v.cancel_policy_text.trim() : null}
                />
              )}
              {isEstetica && esteticaStaff.some((t) => t.photo_url || t.bio) && (
                <div className="mb-5">
                  <h4 className="font-display text-base font-semibold mb-2">💇 Nuestro equipo</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {esteticaStaff.map((t) => (
                      <div key={t.id} className="rounded-2xl border border-border bg-card p-3 text-center">
                        <div className="h-16 w-16 rounded-full overflow-hidden mx-auto bg-muted">
                          <ProductImage src={t.photo_url} name={t.name} vertical="estetica" alt={t.name} className="w-full h-full object-cover" />
                        </div>
                        <p className="font-semibold text-sm mt-2 truncate">{t.name}</p>
                        {t.bio && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.bio}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(!isEstetica || esteticaServices.length === 0) && (
                <BookingForm
                  vendorId={v.id}
                  vendorName={v.store_name}
                  services={isEstetica && esteticaServices.length > 0 ? undefined : offers?.map((o: any) => ({ id: o.id, name: o.name }))}
                  serviceOptions={isEstetica && esteticaServices.length > 0 ? esteticaServices : undefined}
                  staffOptions={isEstetica && esteticaStaff.length > 0 ? esteticaStaff : undefined}
                  locationOptions={isEstetica && esteticaLocations.length > 0 ? esteticaLocations : undefined}
                  cancelPolicy={isEstetica && typeof v.cancel_policy_text === "string" && v.cancel_policy_text.trim() ? v.cancel_policy_text.trim() : null}
                />
              )}
            </div>
            )}

            {serviceQuotaFull && (
              <div className="border border-border rounded-2xl p-6 bg-card mb-6 text-center">
                <p className="text-sm font-medium">Este profesional completó sus solicitudes online del mes.</p>
                <p className="text-sm text-muted-foreground mt-1">Escribile directo por WhatsApp 👇</p>
              </div>
            )}

            {/* Productos del centro (estética): cosmética y accesorios con carrito */}
            {isEstetica && acceptsCart && sections.length > 0 && (
              <>
                <h2 className="font-display text-2xl font-semibold mt-6 mb-4">🛍️ Productos</h2>
                {promos.length > 0 && (
                  <PromoSection
                    items={promos}
                    vendor={vendorBrief}
                    modifiersByProduct={modifiersByProduct}
                    acceptsCart={acceptsCart}
                    consultHref={waUrl}
                  />
                )}
                {sections.map((s, i) => (
                  <section key={s.name} id={`seccion-${i}`} className="mb-10">
                    <h3 className="font-display text-xl font-semibold mb-4 border-b border-border pb-2">
                      {s.name}
                    </h3>
                    <div className="space-y-3">
                      {s.items.map((o: any) => (
                        <div key={o.id} data-pname={String(o.name).toLowerCase()}>
                          <GastroProductRow
                            product={o}
                            vendor={vendorBrief}
                            modifiers={modifiersByProduct[o.id] || []}
                            acceptsCart={acceptsCart}
                            consultHref={waUrl}
                            images={imagesByProduct[o.id] || []}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </>
            )}

            {/* Packs de sesiones y giftcards (estética): compra online con MP */}
            {isEstetica && !menuHidden && (
              <div className="mt-6 mb-6 space-y-4">
                {esteticaPacks.length > 0 && (
                  <>
                    <h2 className="font-display text-2xl font-semibold">🎟️ Packs de sesiones</h2>
                    <p className="text-sm text-muted-foreground -mt-2">
                      Los pagás online y las sesiones quedan a tu nombre para usar en tus turnos.
                    </p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {esteticaPacks.map((p) => (
                        <PackBuyCard
                          key={p.id}
                          vendorId={v.id}
                          pack={p}
                          mpConnected={esteticaMpConnected}
                          waUrl={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Hola ${v.store_name}! Quiero el pack ${p.name}. Vengo de Portal 659.`)}`}
                        />
                      ))}
                    </div>
                  </>
                )}
                <h2 className="font-display text-2xl font-semibold">🎁 Giftcards</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                  <GiftcardBuyCard vendorId={v.id} mpConnected={esteticaMpConnected} waUrl={waUrl} />
                </div>
              </div>
            )}

            {/* Consultanos (estética): al final, colapsado salvo sin servicios */}
            {isEstetica && v.accepting_quotes && !serviceQuotaFull && (
              <details
                className="border border-border rounded-2xl bg-card mt-6 mb-6 group"
                open={esteticaServices.length === 0}
              >
                <summary className="cursor-pointer list-none p-6 font-display text-lg font-semibold flex items-center justify-between gap-2">
                  <span>💬 Consultanos</span>
                  <span className="text-muted-foreground text-sm group-open:rotate-180 transition-transform">▾</span>
                </summary>
                <div className="px-6 pb-6">
                  <p className="text-sm text-muted-foreground mb-4">
                    ¿No encontrás lo que buscás? Escribinos y te asesoramos.
                  </p>
                  <QuoteForm
                    vendorId={v.id}
                    vendorName={v.store_name}
                    servicesList={v.services_list}
                    estetica
                    prefEnabled={v.quote_pref_enabled !== false}
                    prefDays={Array.isArray(v.quote_days) ? v.quote_days : undefined}
                    prefSlots={Array.isArray(v.quote_slots) ? v.quote_slots : undefined}
                  />
                </div>
              </details>
            )}
          </>
        ) : (noCart || menuHidden) && sections.length === 0 ? (
          <>
            {/* Solo contacto sin carta cargada: tarjeta de contacto directa */}
            <div className="border border-border rounded-2xl p-8 text-center bg-card mt-6 mb-6">
              <h2 className="font-display text-2xl font-semibold mb-2">
                Contactanos directo
              </h2>
              <p className="text-muted-foreground max-w-md mx-auto mb-2">
                {v.description || "Este local atiende por WhatsApp. Escribinos y te respondemos a la brevedad."}
              </p>
              {v.hours && (
                <div className="mb-4">
                  <WeeklyHours hours={v.hours} openNow={isStoreOpen(v as any)} />
                </div>
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
            <h2 id="menu" className="font-display text-2xl font-semibold mt-6 mb-4 scroll-mt-[152px] sm:scroll-mt-16">{isCatalog ? "Catálogo" : "Menú"}</h2>
            {showVolume && acceptsCart && packGroups.length > 0 && (
              <a
                href="#packs"
                className="flex items-center justify-between gap-3 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 mb-4 hover:shadow-md active:scale-[0.99] transition-all"
              >
                <span className="min-w-0">
                  <span className="block font-semibold text-sm text-emerald-900">🧊 Armá tu pack a precio conveniente</span>
                  <span className="block text-xs text-emerald-700 mt-0.5">Elegí tus gustos entre los combinables</span>
                </span>
                <span aria-hidden="true" className="text-emerald-700 font-bold flex-shrink-0">↓</span>
              </a>
            )}
            {promos.length > 0 && (
              <PromoSection
                items={promos}
                vendor={vendorBrief}
                modifiersByProduct={modifiersByProduct}
                acceptsCart={acceptsCart}
                consultHref={waUrl}
              />
            )}
            {sections.length === 0 ? (
              <p className="text-muted-foreground text-center py-12">
                Este local todavía no cargó {isCatalog ? "su catálogo" : "su menú"}.
              </p>
            ) : (
              <>
                {sections.length > 0 && <CategoryNav sections={sections} catalog={isCatalog} />}
                {sections.map((s, i) => (
                  <section key={s.name} id={`seccion-${i}`} className="mb-10 scroll-mt-[184px] sm:scroll-mt-24">
                    <h3 className="font-display text-xl font-semibold mb-4 border-b border-border pb-2">
                      {s.name}
                    </h3>
                    <div className={useCards ? "grid grid-cols-2 sm:grid-cols-3 gap-3" : "space-y-3"}>
                      {s.items.map((o: any) => {
                        if (useCards) {
                          return (
                            <div key={o.id} id={`product-${o.id}`} data-pname={String(o.name).toLowerCase()} className="scroll-mt-16 sm:scroll-mt-24">
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
                        // Galería = portada primero + extras (dedup): igual que ProductCard.
                        const _seen = new Set<string>();
                        const oAllImages = [
                          ...(o.image_url ? [{ image_url: o.image_url }] : []),
                          ...oImages,
                        ].filter((im: any) => {
                          const u = im?.image_url;
                          if (!u || _seen.has(u)) return false;
                          _seen.add(u);
                          return true;
                        });
                        if (oVariants.length > 0) {
                          const range = variantRange(oVariants);
                          const totalStock = oVariants.reduce((a, v: any) => a + (v.stock ?? 0), 0);
                          const stockControl = o.stock_control !== false;
                          return (
                            <div
                              key={o.id}
                              id={`product-${o.id}`}
                              data-pname={String(o.name).toLowerCase()}
                              className="border border-border rounded-xl p-4 bg-card space-y-3 scroll-mt-16 sm:scroll-mt-24"
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
                                    {oAllImages.length > 1 && (
                                      <Badge variant="secondary" className="text-[10px]">📷 {oAllImages.length}</Badge>
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
                        <div key={o.id} data-pname={String(o.name).toLowerCase()}>
                          <GastroProductRow
                            product={o}
                            vendor={vendorBrief}
                            modifiers={modifiersByProduct[o.id] || []}
                            acceptsCart={acceptsCart}
                            consultHref={waUrl}
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
          </>
        )}

        {/* Packs para armar: un punto de entrada por pack (multi-producto) */}
        {showVolume && acceptsCart && !menuHidden && packGroups.length > 0 && (
          <section id="packs" className="mt-6 mb-10 scroll-mt-[184px] sm:scroll-mt-24">
            <h3 className="font-display text-xl font-semibold mb-3">🧊 Armá tu pack</h3>
            <div className="space-y-2">
              {packGroups.map((g: any) => (
                <PackCard key={g.id} group={g} />
              ))}
            </div>
          </section>
        )}
        {showVolume && acceptsCart && volumeGroups.length > 0 && <PackSheetHost groups={volumeGroups} vendor={vendorBrief} modifiersByProduct={modifiersByProduct} />}

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
          isRetail={isCatalog}
          isUrgent={!isEstetica && isService && v.urgent_enabled}
          urgentUrl={`https://wa.me/${waNumber}?text=${encodeURIComponent(`🚨 URGENTE - Necesito ${v.store_name} lo antes posible.`)}`}
          urgentLabel={urgentSurcharge != null ? `🚨 Urgente +${urgentSurcharge}%` : undefined}
        />
      )}
    </main>
  );
}
