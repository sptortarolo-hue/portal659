import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("product_id");

  if (productId) {
    const variants = await queryMany<Record<string, unknown>>(
      `SELECT * FROM product_variants WHERE product_id = $1 ORDER BY position ASC`,
      [productId]
    );
    return NextResponse.json({ variants: variants || [] });
  }

  if (!vendor) return NextResponse.json({ variants: [] });

  const products = await queryMany<{ id: string }>(
    `SELECT id FROM products WHERE vendor_id = $1`,
    [vendor.id]
  );
  const ids = (products || []).map((p) => p.id);
  if (ids.length === 0) return NextResponse.json({ variants: [] });

  const variants = await queryMany<Record<string, unknown>>(
    `SELECT * FROM product_variants WHERE product_id = ANY($1) ORDER BY position ASC`,
    [ids]
  );
  return NextResponse.json({ variants: variants || [] });
}

export async function PUT(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  const body = await request.json();
  const { product_id, variants } = body;

  if (!product_id || !Array.isArray(variants)) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const product = await queryOne<{ id: string; vendor_id: string }>(
    `SELECT id, vendor_id FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [product_id, vendor.id]
  );
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const rows = (variants as any[]).map((v, i) => ({
    product_id,
    color: String(v.color || "").trim(),
    talle: String(v.talle || "").trim(),
    price: Number(v.price || 0),
    promo: v.promo !== undefined && v.promo !== null && v.promo !== "" ? Number(v.promo) : null,
    stock: Number(v.stock || 0),
    sku: String(v.sku ?? "").trim() ? String(v.sku).trim().slice(0, 64) : null,
    cost_last: v.cost_last != null && v.cost_last !== "" && Number.isFinite(Number(v.cost_last)) && Number(v.cost_last) >= 0 ? Number(v.cost_last) : null,
    position: i,
  }));

  // Códigos (SKU) únicos en TODO el local: el escáner de mostrador no puede
  // haber ambigüedad contra variantes de otros productos ni contra la base del
  // producto (products.sku).
  const skusNorm = rows
    .map((r) => r.sku)
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase());
  const rowDups = skusNorm.length !== new Set(skusNorm).size;
  if (rowDups) {
    return NextResponse.json({ error: "Hay dos variantes con el mismo código" }, { status: 400 });
  }
  const mySkus = skusNorm;
  const foreign = await queryMany<{ table_name: string; code: string }>(
    `SELECT 'variante' AS table_name, LOWER(sku) AS code FROM product_variants pv
       JOIN products p ON p.id = pv.product_id AND p.vendor_id = $1
      WHERE pv.product_id != $2 AND pv.sku IS NOT NULL
      UNION ALL
      SELECT 'producto' AS table_name, LOWER(sku) AS code FROM products p2
       WHERE p2.vendor_id = $1 AND p2.id != $2 AND p2.sku IS NOT NULL`,
    [vendor.id, product_id]
  ).catch(() => []);
  if (foreign.length > 0) {
    const foreignSet = new Set(foreign.map((f) => f.code));
    const clash = mySkus.find((s) => foreignSet.has(s));
    if (clash) {
      const owner = foreign.find((f) => f.code === clash);
      return NextResponse.json(
        { error: owner?.table_name === "producto" ? `El código ya lo usa otro producto del local` : `El código ya lo usa una variante de otro producto` },
        { status: 400 }
      );
    }
  }

  // Transacción atómica: si un INSERT falla en el medio, no quedan variantes
  // parciales (antes iba DELETE + INSERT sueltos y un fallo corrompía el menú).
  const hasCost = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'product_variants' AND column_name = 'cost_last') AS exists`
  ).catch(() => null);
  await withTransaction(async (tx) => {
    await tx.queryVoid(`DELETE FROM product_variants WHERE product_id = $1`, [product_id]);
    for (const row of rows) {
      if (hasCost?.exists === true) {
        await tx.queryVoid(
          `INSERT INTO product_variants (product_id, color, talle, price, promo, stock, sku, cost_last, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [row.product_id, row.color, row.talle, row.price, row.promo, row.stock, row.sku, row.cost_last, row.position]
        );
      } else {
        await tx.queryVoid(
          `INSERT INTO product_variants (product_id, color, talle, price, promo, stock, sku, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [row.product_id, row.color, row.talle, row.price, row.promo, row.stock, row.sku, row.position]
        );
      }
    }
  });

  // Las variantes (precios/promos de moda) cambiaron: versionar la tarjeta.
  const { touchPromoVersion } = await import("@/lib/promo-server");
  await touchPromoVersion(vendor.id);

  return NextResponse.json({ ok: true });
}
