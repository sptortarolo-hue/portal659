import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany } from "@/lib/db";
import { attachShipments } from "@/lib/shipping-server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json(
      { error: "No tenés un local registrado" },
      { status: 403 }
    );
  }

  const orders = await queryMany<Record<string, unknown>>(
    `SELECT * FROM orders WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [vendor.id]
  );

  // Flag giftcard-only por pedido (el flow salta Empaquetando): 1 query de
  // productos gift + match en JS. Tolerante a DBs sin columna sku.
  let giftIds = new Set<string>();
  try {
    const grows = await queryMany<{ id: string }>(
      `SELECT id FROM products WHERE vendor_id = $1 AND (sku LIKE 'GC-%' OR lower(category) = 'giftcards')`,
      [vendor.id]
    );
    giftIds = new Set((grows || []).map((r) => String(r.id)));
  } catch {
    try {
      const grows = await queryMany<{ id: string }>(
        `SELECT id FROM products WHERE vendor_id = $1 AND lower(category) = 'giftcards'`,
        [vendor.id]
      );
      giftIds = new Set((grows || []).map((r) => String(r.id)));
    } catch {
      giftIds = new Set();
    }
  }
  const withFlags = (orders || []).map((o) => {
    const items = (o as any).items;
    const isGiftOnly =
      Array.isArray(items) &&
      items.length > 0 &&
      items.every(
        (i: any) => i && typeof i.product_id === "string" && i.product_id !== "" && giftIds.has(i.product_id)
      );
    return { ...o, is_gift_only: isGiftOnly };
  });
  // Envío extendido embebido (bloque violeta del detalle disponible al abrir).
  await attachShipments(withFlags, vendor.id).catch(() => undefined);

  return NextResponse.json({ orders: withFlags });
}