import { queryMany } from "@/lib/db";
import { queryEffectiveModifiers } from "@/lib/modifier-rules";
import { discountOf } from "@/lib/promo";

/**
 * Datos de carta para /carta/[slug] (vista solo-lectura de mesa).
 * Subconjunto de lo que arma /tienda/[slug]: productos disponibles,
 * secciones por categoría, promos, modificadores, variantes e imágenes.
 * Sin packs armables, sin delivery, sin reseñas, sin turnera.
 * Todo tolerante a migraciones sin aplicar (igual que el micrositio).
 */

export type CartaSection = { name: string; items: any[] };

export type CartaService = {
  id: string;
  name: string;
  description: string | null;
  duration_min: number | null;
  price: number | null;
};

export type CartaData = {
  offers: any[];
  cats: any[];
  sections: CartaSection[];
  promos: any[];
  modifiersByProduct: Record<string, any[]>;
  variantsByProduct: Record<string, any[]>;
  imagesByProduct: Record<string, any[]>;
  services: CartaService[];
};

const norm = (s: string | null) => (s || "").toLowerCase().trim();

export async function loadCartaData(vendorId: string, isCatalog: boolean): Promise<CartaData> {
  const offers =
    (await queryMany<any>(
      `SELECT * FROM products WHERE vendor_id = $1 AND available = true ORDER BY featured_today DESC, name ASC`,
      [vendorId]
    ).catch(() => [])) || [];

  const cats =
    (await queryMany<any>(
      `SELECT * FROM vendor_categories WHERE vendor_id = $1 ORDER BY position ASC`,
      [vendorId]
    ).catch(() => [])) || [];

  const menuOffers = offers.filter((o: any) => o.promo_only !== true);
  const promos = offers
    .filter((o: any) => o.promo_price != null || o.promo_only === true)
    .sort((a: any, b: any) => discountOf(b) - discountOf(a));

  const sections: CartaSection[] = [];
  if (cats.length > 0) {
    const used = new Set<string>();
    for (const c of cats) {
      const items = menuOffers.filter((o: any) => norm(o.category) === norm(c.name));
      if (items.length) {
        sections.push({ name: c.name, items });
        used.add(norm(c.name));
      }
    }
    const leftovers = menuOffers.filter((o: any) => !used.has(norm(o.category)));
    if (leftovers.length) sections.push({ name: "Otros", items: leftovers });
  } else if (menuOffers.length) {
    sections.push({ name: isCatalog ? "Catálogo" : "Menú", items: menuOffers });
  }

  const productIds = offers.map((o: any) => o.id) || [];
  let allModifiers: any[] = [];
  if (productIds.length > 0) {
    try {
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
  for (const mod of allModifiers || []) {
    (modifiersByProduct[mod.product_id] ||= []).push(mod);
  }

  const variantProductIds = offers.filter((o: any) => o.has_variants).map((o: any) => o.id);
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
  for (const v of allVariants || []) {
    (variantsByProduct[v.product_id] ||= []).push(v);
  }

  let allProductImages: any[] = [];
  if (productIds.length > 0) {
    try {
      allProductImages = await queryMany<any>(
        `SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY position ASC`,
        [productIds]
      );
    } catch {
      allProductImages = [];
    }
  }
  const imagesByProduct: Record<string, any[]> = {};
  for (const img of allProductImages || []) {
    (imagesByProduct[img.product_id] ||= []).push(img);
  }

  // Servicios (verticales servicio/estética): lista simple de lectura.
  // Precio vive en otra migración: se intenta con price y se reintenta sin él.
  let services: CartaService[] = [];
  try {
    let rows: any[] | null = null;
    try {
      rows = await queryMany<any>(
        `SELECT id, name, description, duration_min, price FROM services WHERE vendor_id = $1 AND active = true ORDER BY position ASC, name ASC`,
        [vendorId]
      );
    } catch {
      rows = await queryMany<any>(
        `SELECT id, name, description, duration_min FROM services WHERE vendor_id = $1 AND active = true ORDER BY position ASC, name ASC`,
        [vendorId]
      );
    }
    services = (rows || []).map((s: any) => ({
      id: String(s.id),
      name: String(s.name ?? ""),
      description: s.description != null ? String(s.description) : null,
      duration_min: s.duration_min != null ? Number(s.duration_min) : null,
      price: s.price != null ? Number(s.price) : null,
    }));
  } catch {
    services = [];
  }

  return { offers, cats, sections, promos, modifiersByProduct, variantsByProduct, imagesByProduct, services };
}

/** Rango min/max de variantes (para la fila display-only, espejo del micrositio). */
export function variantRange(vars: any[]) {
  const prices = vars.map((x) => (x.promo != null ? Number(x.promo) : Number(x.price)));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const discounts = vars
    .filter((x) => x.promo != null && Number(x.price) > 0)
    .map((x) => Math.round((1 - Number(x.promo) / Number(x.price)) * 100));
  const best = discounts.length > 0 ? Math.max(...discounts) : null;
  return { min, max, best };
}
