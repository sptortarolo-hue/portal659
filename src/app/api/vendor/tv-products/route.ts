import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Productos disponibles del comercio activo, para el picker de productos
 * por franja horaria de la Pantalla TV.
 *
 * Devuelve todos los productos disponibles (no solo los de la franja activa):
 * el comercio elige cuáles pertenecen a cada franja desde el editor.
 */
export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const rows = await queryMany<any>(
    `SELECT id, name, price, image_url, category FROM products
     WHERE vendor_id = $1 AND available = true
     ORDER BY name ASC`,
    [vendor.id],
  );

  const products = (rows || []).map((p: any) => ({
    id: String(p.id),
    name: String(p.name ?? ""),
    priceLabel: p.price != null ? `$${Number(p.price).toLocaleString("es-AR", { minimumFractionDigits: 0 })}` : null,
    imageUrl: p.image_url ?? null,
    category: p.category ?? null,
  }));

  return NextResponse.json({ products });
}
