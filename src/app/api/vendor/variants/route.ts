import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, query } from "@/lib/db";
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
  if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });

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

  await query(`DELETE FROM product_variants WHERE product_id = $1`, [product_id]);

  const rows = (variants as any[]).map((v, i) => ({
    product_id,
    color: String(v.color || "").trim(),
    talle: String(v.talle || "").trim(),
    price: Number(v.price || 0),
    promo: v.promo !== undefined && v.promo !== null && v.promo !== "" ? Number(v.promo) : null,
    stock: Number(v.stock || 0),
    sku: v.sku ? String(v.sku) : null,
    position: i,
  }));

  for (const row of rows) {
    await query(
      `INSERT INTO product_variants (product_id, color, talle, price, promo, stock, sku, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.product_id, row.color, row.talle, row.price, row.promo, row.stock, row.sku, row.position]
    );
  }

  return NextResponse.json({ ok: true });
}