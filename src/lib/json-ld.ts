import { ZONES } from "./config";
import { parseWeeklyHours } from "./open-hours";

// ---------------------------------------------------------------------------
// JSON-LD (schema.org) — SEO local y rich results.
// Server-only helpers puros (reciben datos ya cargados). Tipos sueltos a
// propósito: un Record JSON serializable, sin depender de paquetes externos.
// ---------------------------------------------------------------------------

type JsonLd = Record<string, unknown>;

/** Tipo schema.org por vertical (rich results de negocio local). */
export function businessTypeForVertical(vertical: string | null | undefined): string {
  switch (vertical) {
    case "gastronomia":
      return "Restaurant";
    case "moda":
      return "ClothingStore";
    case "servicio":
      return "ProfessionalService";
    case "estetica":
    case "salud":
      return "HealthAndBeautyBusiness";
    case "comercio":
      return "Store";
    default:
      return "LocalBusiness";
  }
}

/** Nombre legible del vertical para títulos/metas ("comercio" → "Comercio del barrio"). */
const VERTICAL_SEO_NAME: Record<string, string> = {
  gastronomia: "Gastronomía y delivery",
  comercio: "Kioscos, almacenes y comercios",
  moda: "Ropa y accesorios",
  servicio: "Servicios y oficios",
  estetica: "Estética y belleza",
  salud: "Salud y bienestar",
};

export function verticalSeoName(vertical: string | null | undefined): string {
  return (vertical && VERTICAL_SEO_NAME[vertical]) || "Comercios";
}

/** "sicardi" → "Sicardi" (barrio a texto humano). */
export function neighborhoodLabel(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Nombre de la zona que contiene un barrio (para areaServed). */
export function zoneNameForNeighborhood(neighborhood: string | null | undefined): string | null {
  if (!neighborhood) return null;
  const z = ZONES.find((zone) => zone.neighborhoods.includes(neighborhood));
  return z?.name || neighborhoodLabel(neighborhood);
}

// Dia JS (0=dom..6=sab) → schema.org
const SCHEMA_DAYS = [
  "https://schema.org/Sunday",
  "https://schema.org/Monday",
  "https://schema.org/Tuesday",
  "https://schema.org/Wednesday",
  "https://schema.org/Thursday",
  "https://schema.org/Friday",
  "https://schema.org/Saturday",
] as const;

/**
 * `vendors.hours` (formato del editor) → `openingHoursSpecification`.
 * Tolerante: si no parsea, devuelve undefined (el negocio igual se indexa).
 */
export function openingHoursForJsonLd(hours: string | null | undefined): JsonLd[] | undefined {
  const weekly = parseWeeklyHours(hours);
  if (!weekly) return undefined;
  const specs: JsonLd[] = [];
  for (const day of weekly) {
    if (day.closed) continue;
    const dayOfWeek = SCHEMA_DAYS[day.dayIdx];
    if (day.text.includes("24")) {
      specs.push({ "@type": "OpeningHoursSpecification", dayOfWeek, opens: "00:00", closes: "23:59" });
      continue;
    }
    // text viene como "09:00–13:00 · 17:00–22:00"
    for (const range of day.text.split("·")) {
      const m = range.trim().match(/^(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})$/);
      if (m) specs.push({ "@type": "OpeningHoursSpecification", dayOfWeek, opens: m[1], closes: m[2] });
    }
  }
  return specs.length > 0 ? specs : undefined;
}

/** LocalBusiness por vertical, con dirección, geo, horarios y rating. */
export function vendorJsonLd(opts: {
  siteUrl: string;
  vendor: {
    slug: string;
    store_name: string;
    vertical?: string | null;
    category?: string | null;
    description?: string | null;
    address?: string | null;
    neighborhood?: string | null;
    whatsapp?: string | null;
    image_url?: string | null;
    logo_url?: string | null;
    instagram?: string | null;
    facebook?: string | null;
    hours?: string | null;
    lat?: number | null;
    lng?: number | null;
  };
  avgRating?: number | null;
  reviewCount?: number;
}): JsonLd {
  const { siteUrl, vendor: v, avgRating, reviewCount } = opts;
  const sameAs = [
    v.instagram ? (v.instagram.startsWith("http") ? v.instagram : `https://instagram.com/${v.instagram.replace("@", "")}`) : null,
    v.facebook ? (v.facebook.startsWith("http") ? v.facebook : `https://facebook.com/${v.facebook.replace("@", "")}`) : null,
  ].filter(Boolean) as string[];

  return {
    "@context": "https://schema.org",
    "@type": businessTypeForVertical(v.vertical),
    name: v.store_name,
    url: `${siteUrl}/tienda/${v.slug}`,
    ...(v.description ? { description: v.description.slice(0, 300) } : {}),
    ...(v.category ? { additionalType: v.category } : {}),
    image: v.image_url || v.logo_url || undefined,
    ...(v.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: v.address,
            addressLocality: "La Plata",
            addressRegion: "Buenos Aires",
            addressCountry: "AR",
          },
        }
      : {}),
    ...(zoneNameForNeighborhood(v.neighborhood) ? { areaServed: zoneNameForNeighborhood(v.neighborhood) } : {}),
    ...(v.lat != null && v.lng != null ? { geo: { "@type": "GeoCoordinates", latitude: v.lat, longitude: v.lng } } : {}),
    ...(v.whatsapp ? { telephone: v.whatsapp } : {}),
    ...(openingHoursForJsonLd(v.hours) ? { openingHoursSpecification: openingHoursForJsonLd(v.hours) } : {}),
    ...(avgRating != null && reviewCount
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Number(avgRating.toFixed(1)), reviewCount } }
      : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

/** Breadcrumbs (Inicio › Comercios › Tienda) — migas en Google. */
export function breadcrumbJsonLd(items: { name: string; url: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/** WebSite + SearchAction (cuadro de búsqueda en resultados de marca). */
export function websiteJsonLd(siteUrl: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Portal 659",
    alternateName: "El centro comercial de tu barrio",
    url: siteUrl,
    inLanguage: "es-AR",
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${siteUrl}/buscar?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

/** Organization de la marca (conocimiento de marca en Google). */
export function organizationJsonLd(siteUrl: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Portal 659",
    url: siteUrl,
    logo: `${siteUrl}/icons/icon-512.png`,
    description:
      "Centro comercial digital de barrio: comercios, gastronomía y servicios de Sicardi y Garibaldi con pedido o contacto directo por WhatsApp, 0% comisión.",
    areaServed: "Sicardi y Garibaldi, La Plata, Buenos Aires",
  };
}

/** ItemList de comercios (la home es, de hecho, un directorio). */
export function itemListJsonLd(items: { name: string; url: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: it.url,
      name: it.name,
    })),
  };
}
