import { NextResponse } from "next/server";
import { queryMany, queryOne } from "@/lib/db";
import { authWaBot } from "@/lib/wa-bot";
import { isStoreOpen, openStatusText, nextOpeningText } from "@/lib/open-hours";

/** Menú agregado del portal: todas las tiendas visibles con sus productos.
 *  Lo consume el bot del portal (conserje del barrio) para responder
 *  "qué tiendas hay", "tienen milanesa?", etc. y tomar pedidos por tienda.
 *  Exige `WA_BOT_SECRET` (endpoint interno). */
export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const stores = await queryMany<any>(
    `SELECT id, store_name, slug, vertical, hours, open_override, address, neighborhood,
            transfer_alias, transfer_cbu, transfer_holder, delivery_options, cash_discount_pct
     FROM vendors
     WHERE COALESCE(visible, true) = true
       AND slug NOT IN ('admin-portal659','portal659-bot','portal-central')
     ORDER BY store_name ASC`,
    []
  ).catch(() => []);

  if (!stores || stores.length === 0) {
    return NextResponse.json({ vendors: [] });
  }

  const storeIds = stores.map((s) => s.id);

  const products = await queryMany<any>(
    `SELECT id, vendor_id, name, description, price, promo_price, category, available,
            requires_prep, stock_control, stock, has_variants
     FROM products WHERE vendor_id = ANY($1) AND available = true
     ORDER BY featured_today DESC, name ASC`,
    [storeIds]
  ).catch(() => []);

  const productIds = (products || []).map((p) => p.id).filter(Boolean);

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

  const variantProductIds = (products || []).filter((p) => p.has_variants).map((p) => p.id);
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

  const storeById = new Map(stores.map((s) => [s.id, s]));

  const outVendors = stores.map((s) => {
    const storeProducts = (products || [])
      .filter((p) => p.vendor_id === s.id)
      .map((p) => ({
        id: p.id,
        store_id: s.id,
        store_name: s.store_name,
        store_slug: s.slug,
        name: p.name,
        description: p.description,
        price: p.promo_price != null ? Number(p.promo_price) : Number(p.price),
        category: p.category,
        requires_prep: p.requires_prep !== false,
        stock_control: p.stock_control === true,
        stock: p.stock,
        modifiers: modifiersByProduct[p.id] || [],
        variants: variantsByProduct[p.id] || [],
      }));
    const storeOpen = isStoreOpen(s);
    const nextOpen = storeOpen === false ? nextOpeningText(s.hours) : null;
    return {
      id: s.id,
      store_name: s.store_name,
      slug: s.slug,
      vertical: s.vertical,
      address: s.address,
      neighborhood: s.neighborhood,
      store_open: storeOpen,
      open_text: openStatusText(storeOpen),
      next_open_text: nextOpen,
      hours: s.hours || null,
      transfer_alias: s.transfer_alias || null,
      transfer_cbu: s.transfer_cbu || null,
      transfer_holder: s.transfer_holder || null,
      delivery_options: s.delivery_options || "ambos",
      cash_discount_pct: s.cash_discount_pct != null ? Number(s.cash_discount_pct) : null,
      products: storeProducts,
    };
  });

  return NextResponse.json({ vendors: outVendors });
}
