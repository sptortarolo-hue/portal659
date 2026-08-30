import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ modifiers: [] });

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("product_id");

  if (productId) {
    const modifiers = await queryMany<Record<string, unknown>>(
      `SELECT * FROM product_modifiers WHERE product_id = $1 ORDER BY position ASC`,
      [productId]
    );
    return NextResponse.json({ modifiers: modifiers || [] });
  }

  const products = await queryMany<{ id: string }>(
    `SELECT id FROM products WHERE vendor_id = $1`,
    [vendor.id]
  );
  const ids = (products || []).map((p) => p.id);
  if (ids.length === 0) return NextResponse.json({ modifiers: [] });

  const modifiers = await queryMany<Record<string, unknown>>(
    `SELECT * FROM product_modifiers WHERE product_id = ANY($1) ORDER BY position ASC`,
    [ids]
  );
  return NextResponse.json({ modifiers: modifiers || [] });
}

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });

  const body = await request.json();
  const { product_id, group_name, options, required, max_selections } = body;

  if (!product_id || !group_name) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const product = await queryOne<{ id: string }>(
    `SELECT id FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [product_id, vendor.id]
  );
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const normalizedOptions = (Array.isArray(options) ? options : [])
    .map((o: any) => ({
      label: String(o?.label ?? "").trim(),
      price_mod: Number(o?.price_mod ?? o?.price ?? 0) || 0,
    }))
    .filter((o: any) => o.label !== "");

  if (normalizedOptions.length === 0) {
    return NextResponse.json({ error: "El modificador necesita al menos una opción válida" }, { status: 400 });
  }

  const countRow = await queryOne<{ c: number }>(
    `SELECT count(*)::int AS c FROM product_modifiers WHERE product_id = $1`,
    [product_id]
  );

  const modifier = await queryOne<Record<string, unknown>>(
    `INSERT INTO product_modifiers (product_id, group_name, options, required, max_selections, position)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [product_id, group_name, JSON.stringify(normalizedOptions), required || false, max_selections || 1, countRow?.c || 0]
  );

  return NextResponse.json({ modifier });
}