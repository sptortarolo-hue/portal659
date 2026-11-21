import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const order: string[] = Array.isArray(body?.order) ? body.order.map((x: any) => String(x)) : [];
  if (order.length === 0) {
    return NextResponse.json({ error: "Orden vacío" }, { status: 400 });
  }

  // Validar que todos los ids pertenezcan al vendor y sean sugeribles
  const hasCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'suggestible') AS exists`
  ).catch(() => ({ exists: false }));
  if (hasCol?.exists !== true) {
    return NextResponse.json({ error: "Falta aplicar migrate-product-suggestions.sql" }, { status: 503 });
  }

  try {
    await withTransaction(async (tx) => {
      for (let i = 0; i < order.length; i++) {
        await tx.queryVoid(
          `UPDATE products SET suggestible_position = $1
             WHERE id = $2 AND vendor_id = $3 AND suggestible = true`,
          [i + 1, order[i], vendor.id]
        );
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "No se pudo reordenar" }, { status: 500 });
  }
}
