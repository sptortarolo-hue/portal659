import { NextResponse } from "next/server";
import { queryMany } from "@/lib/db";
import { authWaBot } from "@/lib/wa-bot";
import { ZONES, ACTIVE_ZONES } from "@/lib/config";

/** Menú agregado de todos los comercios visibles de la zona activa,
 *  listo para que el bot multi-comercio (Portal 659) lo consuma.
 *  Exige WA_BOT_SECRET. Devuelve comercios con sus productos. */
export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const zoneSlug = url.searchParams.get("zone") || ACTIVE_ZONES[0]?.slug || ZONES[0]?.slug;
  const zone = ZONES.find((z) => z.slug === zoneSlug) || ACTIVE_ZONES[0] || ZONES[0];
  const neighborhoods = zone?.neighborhoods || [];
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  if (neighborhoods.length === 0) {
    return NextResponse.json({ zone: zone?.slug, vendors: [] });
  }

  // Comercios visibles de la zona. Se excluyen los que tienen el catálogo
  // online apagado (accepts_online_orders = false): no aceptan pedidos por
  // el bot. La columna puede no existir si la migración no se aplicó, por
  // eso se hace un fallback sin ese filtro.
  let vendors: any[] = [];
  try {
    vendors = await queryMany<any>(
      `SELECT id, store_name, vertical, neighborhood, hours, open_override, accepts_online_orders
       FROM vendors
       WHERE visible = true AND neighborhood = ANY($1)
         AND COALESCE(accepts_online_orders, true) = true
       ORDER BY store_name ASC`,
      [neighborhoods]
    );
  } catch {
    vendors = await queryMany<any>(
      `SELECT id, store_name, vertical, neighborhood, hours, open_override
       FROM vendors
       WHERE visible = true AND neighborhood = ANY($1)
       ORDER BY store_name ASC`,
      [neighborhoods]
    );
  }

  const vendorIds = vendors.map((v) => v.id);
  if (vendorIds.length === 0) {
    return NextResponse.json({ zone: zone?.slug, vendors: [] });
  }

  // Productos disponibles de esos comercios
  let productSql = `SELECT id, vendor_id, name, description, price, promo_price, category, available
     FROM products WHERE vendor_id = ANY($1) AND available = true`;
  const params: any[] = [vendorIds];
  if (q) {
    productSql += ` AND (LOWER(name) LIKE $2 OR LOWER(description) LIKE $2 OR LOWER(category) LIKE $2)`;
    params.push(`%${q}%`);
  }
  productSql += ` ORDER BY name ASC`;
  const products = await queryMany<any>(productSql, params);

  // Modificadores por producto
  const productIds = products.map((p) => p.id).filter(Boolean);
  let modifiersByProduct: Record<string, any[]> = {};
  if (productIds.length > 0) {
    let mods: any[] = [];
    try {
      mods = await queryMany<any>(
        `SELECT g.group_name, g.options, g.required, g.max_selections, l.product_id
         FROM product_modifier_links l
         JOIN modifier_groups g ON g.id = l.group_id
         WHERE l.product_id = ANY($1)
         ORDER BY l.position ASC`,
        [productIds]
      );
    } catch {
      try {
        mods = await queryMany<any>(
          `SELECT group_name, options, required, max_selections, product_id
           FROM product_modifiers WHERE product_id = ANY($1) ORDER BY position ASC`,
          [productIds]
        );
      } catch {
        mods = [];
      }
    }
    for (const m of mods) {
      if (!modifiersByProduct[m.product_id]) modifiersByProduct[m.product_id] = [];
      modifiersByProduct[m.product_id].push({
        group_name: m.group_name,
        options: Array.isArray(m.options) ? m.options : [],
        required: m.required,
        max_selections: m.max_selections,
      });
    }
  }

  // Variantes por producto
  const variantProductIds = products.filter((p: any) => p.has_variants).map((p: any) => p.id);
  let variantsByProduct: Record<string, any[]> = {};
  if (variantProductIds.length > 0) {
    try {
      const variants = await queryMany<any>(
        `SELECT id, product_id, color, talle, price, promo, stock
         FROM product_variants WHERE product_id = ANY($1) ORDER BY position ASC`,
        [variantProductIds]
      );
      for (const v of variants) {
        if (!variantsByProduct[v.product_id]) variantsByProduct[v.product_id] = [];
        variantsByProduct[v.product_id].push(v);
      }
    } catch {
      /* sin variantes */
    }
  }

  // Agrupar productos por comercio
  const productsByVendor: Record<string, any[]> = {};
  for (const p of products) {
    if (!productsByVendor[p.vendor_id]) productsByVendor[p.vendor_id] = [];
    productsByVendor[p.vendor_id].push({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.promo_price != null ? Number(p.promo_price) : Number(p.price),
      category: p.category,
      modifiers: modifiersByProduct[p.id] || [],
      variants: variantsByProduct[p.id] || [],
    });
  }

  const result = vendors
    .filter((v) => (productsByVendor[v.id] || []).length > 0)
    .map((v) => ({
      id: v.id,
      store_name: v.store_name,
      vertical: v.vertical,
      neighborhood: v.neighborhood,
      products: productsByVendor[v.id] || [],
    }));

  return NextResponse.json({ zone: zone?.slug, zone_name: zone?.name, vendors: result });
}
