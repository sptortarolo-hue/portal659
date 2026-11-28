import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { buildGondolaA4FullPdf } from "@/lib/gondola-a4-full";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hoja A4 apaisada con etiquetas de góndola completas (70 × 35 mm, 4 × 5).
 *
 * GET /api/vendor/label/gondola-a4?productIds=id,id
 *
 * Ruta existente, ahora alimentada por el módulo nuevo. No toca `/api/print`
 * ni los motores de la etiqueta térmica / adhesiva.
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

  const built = await buildGondolaA4FullPdf({ vendor, productIds });
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
