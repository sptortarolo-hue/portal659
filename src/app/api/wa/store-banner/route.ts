import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";

/**
 * GET /api/wa/store-banner?vendorId=X — genera un JPEG (1280×520) con
 * la bienvenida de una tienda: logo (o inicial), nombre, rubro y
 * "0% comisión". Es la primera imagen visible al entrar a una tienda.
 */

const VERTICAL_COLORS: Record<string, { bg: string; fg: string; fgSoft: string }> = {
  gastronomia: { bg: "#f97316", fg: "#ffffff", fgSoft: "#ffd5b0" },
  comercio:    { bg: "#2496c6", fg: "#ffffff", fgSoft: "#c1e6f4" },
  moda:        { bg: "#a3e635", fg: "#1a1a1a", fgSoft: "#e4f5ab" },
  estetica:    { bg: "#ec4899", fg: "#ffffff", fgSoft: "#f9c4d8" },
  servicio:    { bg: "#8b5cf6", fg: "#ffffff", fgSoft: "#d8cfff" },
  salud:       { bg: "#10b981", fg: "#ffffff", fgSoft: "#c8f0dd" },
  taller:      { bg: "#f97316", fg: "#ffffff", fgSoft: "#ffd5b0" },
};

export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId") || "";
  if (!vendorId) {
    return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });
  }

  const vendor = await queryOne<{ id: string; store_name: string; vertical: string | null; slug: string | null; logo_url: string | null }>(
    `SELECT id, store_name, vertical, slug, logo_url FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  const palette = VERTICAL_COLORS[String(vendor.vertical || "").toLowerCase()] || VERTICAL_COLORS.gastronomia;
  const storeName = String(vendor.store_name || "Tienda").slice(0, 46);
  const initial = storeName.charAt(0).toUpperCase() || "P";
  const categoryLabel = categoryLabelOf(vendor.vertical);

  try {
    const sharp = (await import("sharp")).default;
    const W = 1280;
    const H = 520;

    // Logo del comercio si hay, o una inicial redonda en colores propios.
    let logoCircle: Buffer | null = null;
    if (vendor.logo_url) {
      try {
        const res = await fetch(vendor.logo_url, { signal: AbortSignal.timeout(8_000) });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const circleMask = `<svg width="240" height="240"><circle cx="120" cy="120" r="118" fill="#fff"/></svg>`;
          logoCircle = await sharp(buf)
            .resize(232, 232, { fit: "cover" })
            .composite([{ input: Buffer.from(circleMask), top: 0, left: 0 }])
            .png()
            .toBuffer();
        }
      } catch {
        logoCircle = null;
      }
    }

    const textW = W - 320;

    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" font-family="DejaVu Sans, Liberation Sans, sans-serif">
  <rect width="100%" height="100%" fill="${palette.bg}"/>
  <rect x="0" y="${H - 60}" width="100%" height="60" fill="rgba(0,0,0,0.18)"/>
  ${logoCircle ? "<circle cx='150' cy='230' r='120' fill='#ffffff'/>" : `<circle cx='150' cy='230' r='120' fill='rgba(255,255,255,0.22)'/>`}
  ${logoCircle ? "" : `<text x='150' y='278' text-anchor='middle' font-size='132' font-weight='800' fill='${palette.fg}'>${escapeXml(initial)}</text>`}
  <text x='320' y='180' font-size='64' font-weight='800' fill='${palette.fg}'>${escapeXml(storeName)}</text>
  <text x='320' y='250' font-size='28' fill='${palette.fgSoft}'>${escapeXml(categoryLabel)}</text>
  <text x='320' y='300' font-size='22' fill='${palette.fgSoft}'>Pedí del modo más fácil, como te conviene</text>
  <rect x='320' y='330' width='280' height='46' rx='23' fill='rgba(0,0,0,0.28)'/>
  <text x='345' y='360' font-size='20' fill='#ffffff' font-weight='700'>0% comisión</text>
  <rect x='625' y='330' width='210' height='46' rx='23' fill='rgba(0,0,0,0.28)'/>
  <text x='650' y='360' font-size='20' fill='#ffffff' font-weight='700'>📱 WhatsApp</text>
  <text x='40' y='${H - 22}' font-size='20' fill='rgba(255,255,255,0.85)'>${escapeXml(getSiteUrl().replace(/^https?:\/\//, ""))}</text>
</svg>`;

    const out = await sharp(Buffer.from(svg))
      .composite(logoCircle ? [{ input: logoCircle, top: 110, left: 30 }] : [])
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();

    return new NextResponse(new Uint8Array(out), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error generando banner" }, { status: 500 });
  }
}

function escapeXml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const CATEGORIES: Record<string, string> = {
  gastronomia: "Gastronomía",
  comercio: "Comercio de barrio",
  moda: "Moda",
  estetica: "Peluquería y Estética",
  servicio: "Servicios",
  salud: "Salud y Bienestar",
  taller: "Taller y Reparaciones",
};

function categoryLabelOf(vertical: string | null | undefined): string {
  const v = String(vertical || "").toLowerCase();
  return CATEGORIES[v] || "Comercio local";
}
