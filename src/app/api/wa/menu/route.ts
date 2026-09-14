import { NextResponse } from "next/server";
import { queryOne, queryMany } from "@/lib/db";
import { authWaBot } from "@/lib/wa-bot";

/** Menú público de un vendor, listo para que el bot (NLU) lo consuma.
 *  Exige `WA_BOT_SECRET` (endpoint interno). Devuelve productos + modificadores
 *  (grupos/opciones) + variantes, sin depender del render del micrositio. */
export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId") || url.searchParams.get("vendor_id");

  if (!vendorId) {
    return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });
  }

  const vendor = await queryOne<{ id: string; store_name: string; vertical: string }>(
    `SELECT id, store_name, vertical FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );
  if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });

  const products = await queryMany<any>(
    `SELECT id, name, description, price, promo_price, category, available,
            requires_prep, stock_control, stock, has_variants
     FROM products WHERE vendor_id = $1 AND available = true
     ORDER BY featured_today DESC, name ASC`,
    [vendorId]
  );

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

  const variantProductIds = products.filter((p) => p.has_variants).map((p) => p.id);
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

  return NextResponse.json({
    vendor: { id: vendor.id, store_name: vendor.store_name, vertical: vendor.vertical },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: p.promo_price != null ? Number(p.promo_price) : Number(p.price),
      category: p.category,
      requires_prep: p.requires_prep !== false,
      stock_control: p.stock_control === true,
      stock: p.stock,
      modifiers: modifiersByProduct[p.id] || [],
      variants: variantsByProduct[p.id] || [],
    })),
  });
}