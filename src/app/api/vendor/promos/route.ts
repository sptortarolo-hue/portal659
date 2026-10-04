import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const products = await queryMany<{
    id: string;
    name: string;
    price: number;
    promo_price: number;
    image_url: string | null;
    category: string | null;
  }>(
    `SELECT id, name, price, promo_price, image_url, category FROM products WHERE vendor_id = $1 AND available = true AND (promo_price IS NOT NULL OR promo_only = true) ORDER BY promo_price ASC`,
    [vendor.id]
  );

  let promoImageUrl: string | null = null;
  let productIds: string[] = [];
  let updatedAt: string | null = null;
  try {
    try {
      const row = await queryOne<{
        image_url: string;
        product_ids: unknown;
        updated_at: string;
      }>(
        `SELECT image_url, product_ids, updated_at FROM vendor_promo_images WHERE vendor_id = $1 LIMIT 1`,
        [vendor.id]
      );
      promoImageUrl = row?.image_url || null;
      updatedAt = row?.updated_at || null;
      if (Array.isArray(row?.product_ids)) {
        productIds = (row.product_ids as unknown[]).filter(
          (v): v is string => typeof v === "string"
        );
      }
    } catch {
      const legacy = await queryOne<{ image_url: string }>(
        `SELECT image_url FROM vendor_promo_images WHERE vendor_id = $1 LIMIT 1`,
        [vendor.id]
      );
      promoImageUrl = legacy?.image_url || null;
    }
  } catch {
    promoImageUrl = null;
  }

  return NextResponse.json({
    products: products || [],
    promoImage: promoImageUrl,
    selection: productIds,
    updatedAt,
  });
}
