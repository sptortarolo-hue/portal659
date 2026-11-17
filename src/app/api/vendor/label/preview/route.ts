import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { buildStickerForProduct } from "@/lib/sticker-server";
import { readLabelPrinterConfig } from "@/lib/label-spec";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Milímetros → puntos PDF. */
function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

/**
 * Vista previa REAL de la etiqueta adhesiva (PNG exacto al que se imprime, o
 * PDF al tamaño en milímetros del rollo configurado).
 *
 * GET /api/vendor/label/preview?productId=…&kg=0,75&template=envasado&format=png|pdf
 */
export async function GET(request: Request) {
  const { vendor: gateVendor } = await getVendorByRequest(request);
  if (!gateVendor) {
    return new NextResponse("No autenticado", { status: 401 });
  }
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "png";
  const productId = url.searchParams.get("productId");
  if (!productId) {
    return new NextResponse("productId requerido", { status: 400 });
  }
  const vendor = await queryOne<Record<string, any>>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [gateVendor.id]
  );
  if (!vendor) {
    return new NextResponse("Comercio no encontrado", { status: 404 });
  }
  const kgRaw = url.searchParams.get("kg");
  const kg = kgRaw != null && kgRaw !== "" ? Number(String(kgRaw).replace(",", ".")) : null;
  const template = url.searchParams.get("template");
  const shelfRaw = url.searchParams.get("shelfLifeDays");
  const built = await buildStickerForProduct(vendor, {
    productId,
    kg,
    copies: 1,
    template: template === "gondola" ? "gondola" : template === "envasado" ? "envasado" : null,
    packedAt: url.searchParams.get("packedAt"),
    shelfLifeDays: shelfRaw != null && shelfRaw !== "" ? Number(shelfRaw) : null,
  });
  if (!built.ok) {
    return new NextResponse(built.error, { status: built.status });
  }
  const cfg = built.cfg;
  const sizeLabel = `${cfg.widthMm}x${cfg.heightMm}mm`;
  const baseName = `etiqueta-${sizeLabel}-${built.product.id.slice(0, 8)}`;

  if (format === "pdf") {
    try {
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([mmToPt(cfg.widthMm), mmToPt(cfg.heightMm)]);
      const img = await pdf.embedPng(built.png);
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: mmToPt(cfg.widthMm),
        height: mmToPt(cfg.heightMm),
      });
      const bytes = await pdf.save();
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${baseName}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new NextResponse("No se pudo generar el PDF", { status: 500 });
    }
  }

  return new NextResponse(new Uint8Array(built.png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `inline; filename="${baseName}.png"`,
      "Cache-Control": "no-store",
    },
  });
}
