import { NextResponse } from "next/server";
import { guardTvScreens } from "@/lib/tv-guard";
import { buildTvSnapshot, listVendorScreens } from "@/lib/tv-data";

export const dynamic = "force-dynamic";

/**
 * Preview del panel: MISMO snapshot que ve la TV, pero armado desde el
 * BORRADOR. Así "cómo queda" y "cómo se ve" no pueden divergir, y no hace
 * falta publicar para probar un cambio.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardTvScreens(request);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const row = (await listVendorScreens(guard.ctx.vendorId)).find((r) => r.id === id);
  if (!row) return NextResponse.json({ error: "Pantalla no encontrada" }, { status: 404 });

  const snapshot = await buildTvSnapshot(row, guard.ctx.vendor);
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
