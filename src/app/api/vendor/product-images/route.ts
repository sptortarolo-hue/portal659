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
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

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

  // Tope moda (ropa y accesorios): 1 portada (products.image_url) + hasta
  // 7 extras en product_images = 8 fotos total. Solo moda usa esta tabla
  // hoy (gastro va por image_url), asÃ­ que el cap no afecta a nadie mÃ¡s.
  const MAX_EXTRA_IMAGES = 7;
  // Cada foto puede llevar color de variante (fotos por color, fase A).
  // Tolerante a migraciÃ³n sin aplicar: sin la columna, color queda null.
  const hasColor = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'product_images' AND column_name = 'color'
     ) AS exists`
  );
  const rawItems = (images as (string | { image_url?: string; color?: string | null })[])
    .filter((u) => (typeof u === "string" ? u && u.trim() : u?.image_url && u.image_url.trim()))
    .slice(0, MAX_EXTRA_IMAGES)
    .map((u, i) => {
      const url = (typeof u === "string" ? u : u?.image_url || "").trim();
      const color =
        hasColor?.exists === true && typeof u !== "string" && u?.color && u.color.trim()
          ? u.color.trim()
          : null;
      return { product_id, image_url: url, color, position: i };
    });

  // Atomicidad: si un INSERT falla a mitad, las imÃ¡genes no quedan corruptas.
  await withTransaction(async (tx) => {
    await tx.queryVoid(`DELETE FROM product_images WHERE product_id = $1`, [product_id]);
    for (const row of rawItems) {
      if (hasColor?.exists === true) {
        await tx.queryVoid(
          `INSERT INTO product_images (product_id, image_url, color, position) VALUES ($1, $2, $3, $4)`,
          [row.product_id, row.image_url, row.color, row.position]
        );
      } else {
        await tx.queryVoid(
          `INSERT INTO product_images (product_id, image_url, position) VALUES ($1, $2, $3)`,
          [row.product_id, row.image_url, row.position]
        );
      }
    }
  });
  return NextResponse.json({ ok: true, capped: (images as unknown[]).filter((u) => (typeof u === "string" ? u && u.trim() : u && typeof u === "object" && (u as any).image_url?.trim())).length > MAX_EXTRA_IMAGES });
}
