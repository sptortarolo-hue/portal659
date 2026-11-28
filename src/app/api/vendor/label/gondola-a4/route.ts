import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { buildGondolaA4Pdf } from "@/lib/gondola-a4";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hoja A4 con etiquetas de góndola (solo lectura, no imprime).
 *
 * GET /api/vendor/label/gondola-a4?productIds=id,id&net=1
 *
 * Ruta NUEVA: no toca `/api/print` ni `/api/vendor/label/preview`. Si falta,
 * el panel sigue funcionando igual (las solapas viejas quedan intactas).
 */
export async function GET(request: Request) {
  const { vendor: gateVendor } = await getVendorByRequest(request);
  if (!gateVendor) {
    return new NextResponse("No autenticado", { status: 401 });
  }

  const url = new URL(request.url);
  const rawIds = url.searchParams.get("productIds") || "";
  const productIds = rawIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (productIds.length === 0) {
    return new NextResponse("productIds requerido", { status: 400 });
  }

  const vendor = await queryOne<Record<string, any>>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [gateVendor.id]
  );
  if (!vendor) {
    return new NextResponse("Comercio no encontrado", { status: 404 });
  }

  const built = await buildGondolaA4Pdf({
    vendor,
    productIds,
    includeTaxLine: url.searchParams.get("net") === "1",
  });
  if (!built.ok) {
    return new NextResponse(built.error, { status: built.status });
  }

  return new NextResponse(new Uint8Array(built.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="gondola-a4.pdf"`,
      "Cache-Control": "no-store",
      "X-Labels": String(built.labels),
      "X-Pages": String(built.pages),
    },
  });
}
