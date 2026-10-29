import { getVendorByRequest } from "@/lib/vendor-utils";
import { query, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Reordena la galería del comercio: recibe el array de ids en el orden final. */
export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.map((x: unknown) => String(x)).filter(Boolean)
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "Faltan ids" }, { status: 400 });

  await withTransaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx.query(
        `UPDATE vendor_gallery SET position = $1 WHERE id = $2 AND vendor_id = $3`,
        [i, ids[i], vendor.id]
      );
    }
  });

  return NextResponse.json({ ok: true });
}