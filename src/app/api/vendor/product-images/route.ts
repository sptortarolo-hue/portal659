import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);

  const { searchParams } = new URL(request.url);
  const productId = searchParams.get("product_id");

  if (productId) {
    const images = await queryMany<Record<string, unknown>>(
      `SELECT * FROM product_images WHERE product_id = $1 ORDER BY position ASC`,
      [productId]
    );
    return NextResponse.json({ images: images || [] });
  }

  if (!vendor) return NextResponse.json({ images: [] });

  const products = await queryMany<{ id: string }>(
    `SELECT id FROM products WHERE vendor_id = $1`,
    [vendor.id]
  );
  const ids = (products || []).map((p) => p.id);
  if (ids.length === 0) return NextResponse.json({ images: [] });

  const images = await queryMany<Record<string, unknown>>(
    `SELECT * FROM product_images WHERE product_id = ANY($1) ORDER BY position ASC`,
    [ids]
  );
  return NextResponse.json({ images: images || [] });
}

export async function PUT(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Vendor no encontrado" }, { status: 404 });

  const body = await request.json();
  const { product_id, images } = body;

  if (!product_id || !Array.isArray(images)) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const product = await queryOne<{ id: string }>(
    `SELECT id FROM products WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [product_id, vendor.id]
  );
  if (!product) return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });

  const rows = (images as string[])
    .filter((url) => url && url.trim())
    .map((url, i) => ({ product_id, image_url: url.trim(), position: i }));

  // Atomicidad: si un INSERT falla a mitad, las imágenes no quedan corruptas.
  await withTransaction(async (tx) => {
    await tx.queryVoid(`DELETE FROM product_images WHERE product_id = $1`, [product_id]);
    for (const row of rows) {
      await tx.queryVoid(
        `INSERT INTO product_images (product_id, image_url, position) VALUES ($1, $2, $3)`,
        [row.product_id, row.image_url, row.position]
      );
    }
  });
  return NextResponse.json({ ok: true });
}