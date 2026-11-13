import { ImageResponse } from "next/og";
import { queryOne } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { getSiteUrl } from "@/lib/site-url";
import {
  CARTEL_QR,
  cartelSize,
  cartelTarget,
  cartelTargetUrl,
  type CartelTarget,
  type CartelTemplate,
} from "@/lib/cartel";
import { CartelHoja, CartelPoster, type CartelPosterData } from "@/components/vendor/cartel-poster";

export const runtime = "nodejs";

/** Milímetros → puntos PDF (72 dpi). */
function mmToPt(mm: number): number {
  return (mm * 72) / 25.4;
}

function parseTemplate(raw: string | null): CartelTemplate {
  return raw === "foto" || raw === "minimal" || raw === "colorido" ? raw : "colorido";
}

function parseTarget(raw: string | null): CartelTarget | null {
  return raw === "carta" || raw === "tienda" ? raw : null;
}

/**
 * Cartel imprimible del comercio: PNG (150 dpi) o PDF con el tamaño exacto.
 *
 * El render usa el MISMO componente que la vista previa del navegador
 * (`src/components/vendor/cartel-poster.tsx`), así que lo que se descarga
 * es idéntico a lo que se ve en /vendor/carta-qr.
 *
 * Solo el dueño del comercio (o un admin / la sesión de prueba del mismo
 * comercio) puede descargarlo: el archivo lleva los datos del local.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const url = new URL(request.url);
  const formato = url.searchParams.get("formato") === "pdf" ? "pdf" : "png";
  const plantilla = parseTemplate(url.searchParams.get("plantilla"));
  const spec = cartelSize(url.searchParams.get("size"));

  const vendor = await queryOne<Record<string, any>>(
    `SELECT * FROM vendors WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  if (!vendor) {
    return new Response("No encontrado", { status: 404 });
  }

  // Autorización: dueño del comercio, admin, o la sesión de prueba del mismo.
  const user = await getAuthUser(request);
  const { vendor: active, previewSession } = await getVendorByRequest(request);
  const isOwner = !!user && !!vendor.user_id && vendor.user_id === user.id;
  const isActive = !!active && active.id === vendor.id;
  const allowed = isOwner || isActive || user?.is_admin === true || (previewSession && isActive);
  if (!allowed) {
    return new Response("No autorizado", { status: 403 });
  }

  const targetParam = parseTarget(url.searchParams.get("target"));
  const target = cartelTarget(vendor.vertical, targetParam || vendor.carta_qr_target);
  const siteUrl = getSiteUrl(request);

  // QR: quiet zone amplia + corrección de errores alta (aguanta dirt y
  // se escanea de lejos). Error correction H agranda la grilla: el tamaño
  // del módulo se mantiene porque el QR se dibuja a 1200px.
  let qrDataUrl = "";
  try {
    const { default: QRCode } = await import("qrcode");
    qrDataUrl = await QRCode.toDataURL(cartelTargetUrl(vendor.slug, target, siteUrl), {
      width: CARTEL_QR.width,
      margin: CARTEL_QR.margin,
      errorCorrectionLevel: CARTEL_QR.errorCorrectionLevel,
    });
  } catch {
    return new Response("No se pudo generar el QR", { status: 500 });
  }

  const data: CartelPosterData = {
    storeName: vendor.store_name || "Tu comercio",
    slug: vendor.slug,
    vertical: vendor.vertical ?? null,
    target,
    rubro: vendor.category ?? null,
    barrio: vendor.neighborhood ?? null,
    address: vendor.address || vendor.location || null,
    hours: vendor.hours ?? null,
    whatsapp: vendor.whatsapp ?? null,
    instagram: vendor.instagram ?? null,
    logoUrl: vendor.logo_url ?? null,
    imageUrl: vendor.image_url ?? null,
    qrDataUrl,
    siteUrl,
  };

  const element = spec.sheet ? (
    <CartelHoja data={data} template={plantilla} width={spec.pxW} height={spec.pxH} />
  ) : (
    <CartelPoster
      data={data}
      template={plantilla}
      width={spec.pxW}
      height={spec.pxH}
      compact={spec.compact}
    />
  );

  let png: Buffer;
  try {
    const res = new ImageResponse(element, { width: spec.pxW, height: spec.pxH });
    png = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error("[cartel] fallo el render del poster:", err);
    return new Response("No se pudo generar el cartel", { status: 500 });
  }

  const baseName = `cartel-${vendor.slug}-${plantilla}-${spec.id}`;

  if (formato === "pdf") {
    try {
      const { PDFDocument } = await import("pdf-lib");
      const pdf = await PDFDocument.create();
      const page = pdf.addPage([mmToPt(spec.pageWmm), mmToPt(spec.pageHmm)]);
      const img = await pdf.embedPng(png);
      page.drawImage(img, {
        x: 0,
        y: 0,
        width: mmToPt(spec.pageWmm),
        height: mmToPt(spec.pageHmm),
      });
      const bytes = await pdf.save();
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      console.error("[cartel] fallo el PDF:", err);
      return new Response("No se pudo generar el PDF", { status: 500 });
    }
  }

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${baseName}.png"`,
      "Cache-Control": "no-store",
    },
  });
}
