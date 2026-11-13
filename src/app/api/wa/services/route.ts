import { NextResponse } from "next/server";
import { queryOne, queryMany } from "@/lib/db";
import { authWaBot } from "@/lib/wa-bot";
import { isStoreOpen, openStatusText, nextOpeningText } from "@/lib/open-hours";

/** Servicios públicos de un vendor, listos para que el bot (concierge)
 *  los consuma. Exige `WA_BOT_SECRET`. Tolerante a tabla `services`
 *  inexistente (migración pendiente) → devuelve solo vendor + link. */
export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId") || url.searchParams.get("vendor_id");

  if (!vendorId) {
    return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });
  }

  const vendor = await queryOne<{
    id: string;
    store_name: string;
    vertical: string;
    hours: string | null;
    open_override: boolean | null;
    slug: string | null;
  }>(
    `SELECT id, store_name, vertical, hours, open_override, slug
     FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  const storeOpen = isStoreOpen(vendor);
  const nextOpen = storeOpen === false ? nextOpeningText(vendor.hours) : null;

  // Servicios (tolerante a tabla/columnas ausentes).
  let services: any[] = [];
  try {
    services = await queryMany<any>(
      `SELECT id, name, description, category, duration_min, price, price_from,
              image_url, active, featured_today
       FROM services
       WHERE vendor_id = $1 AND (active IS NULL OR active = true)
       ORDER BY featured_today DESC NULLS LAST, name ASC`,
      [vendorId]
    );
  } catch {
    try {
      services = await queryMany<any>(
        `SELECT id, name, description, category, duration_min, price, price_from,
                image_url, active
         FROM services
         WHERE vendor_id = $1 AND (active IS NULL OR active = true)
         ORDER BY name ASC`,
        [vendorId]
      );
    } catch {
      services = [];
    }
  }

  const micrositeUrl = vendor.slug
    ? `${process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar"}/tienda/${vendor.slug}`
    : null;

  return NextResponse.json({
    vendor: {
      id: vendor.id,
      store_name: vendor.store_name,
      vertical: vendor.vertical,
      hours: vendor.hours,
      store_open: storeOpen,
      open_text: openStatusText(storeOpen),
      next_open_text: nextOpen,
      slug: vendor.slug,
      microsite_url: micrositeUrl,
      reserve_url: micrositeUrl ? `${micrositeUrl}#reservar-turno` : null,
    },
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      duration_min: s.duration_min,
      price: s.price != null ? Number(s.price) : null,
      price_from: s.price_from != null ? Number(s.price_from) : null,
      image_url: s.image_url,
      featured_today: s.featured_today === true,
    })),
  });
}
