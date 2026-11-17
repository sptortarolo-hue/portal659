import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { queryMany, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";

/**
 * GET /api/wa/menu-image?vendorId=X — genera JPEG con collage del catálogo
 * destacado de un comercio. Estilo carta de mesa: celdas grandes, foto
 * del producto + nombre + precio, badge 🔥 para destacados de hoy.
 */

const BRAND = { r: 20, g: 20, b: 20 };
const ACCENT = "#f97316";
const ACCENT_DEEP = "#ea580c";

export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId") || "";
  if (!vendorId) {
    return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });
  }

  const vendor = await queryOne<{ id: string; store_name: string; slug: string | null }>(
    `SELECT id, store_name, slug FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  const products = await queryMany<any>(
    `SELECT id, name, price, promo_price, image_url, category, featured_today
     FROM products WHERE vendor_id = $1 AND available = true AND image_url IS NOT NULL
     ORDER BY featured_today DESC, name ASC
     LIMIT 6`,
    [vendorId]
  ).catch(() => []);

  if (!products || products.length === 0) {
    return NextResponse.json({ error: "Sin productos con imagen" }, { status: 404 });
  }

  try {
    const sharp = (await import("sharp")).default;
    const COLS = 3;
    const ROWS = Math.ceil(products.length / COLS);
    const CELL_W = 360;
    const CELL_H = 330;
    const IMG_H = 220;
    const PAD = 16;
    const TITLE_H = 96;
    const FOOTER_H = 48;
    const W = COLS * CELL_W + (COLS + 1) * PAD;
    const H = TITLE_H + ROWS * CELL_H + (ROWS + 1) * PAD + FOOTER_H;

    // Descargar imágenes de los productos.
    const images: Buffer[] = [];
    for (const p of products) {
      try {
        const res = await fetch(p.image_url, { signal: AbortSignal.timeout(8_000) });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const resized = await sharp(buf)
            .resize(CELL_W - PAD * 2, IMG_H, { fit: "cover" })
            .toBuffer();
          images.push(resized);
        } else {
          images.push(Buffer.alloc(0));
        }
      } catch {
        images.push(Buffer.alloc(0));
      }
    }

    const canvas = sharp({
      create: { width: W, height: H, channels: 3, background: { r: 255, g: 253, b: 250 } },
    });

    const composites: any[] = [];

    // Title bar
    composites.push({
      input: Buffer.from(
        `<svg width="${W}" height="${TITLE_H}" font-family="DejaVu Sans, Liberation Sans, sans-serif">
  <rect width="100%" height="100%" fill="${ACCENT}"/>
  <rect x="0" y="${TITLE_H - 24}" width="100%" height="24" fill="${ACCENT_DEEP}"/>
  <text x="28" y="46" font-size="30" font-weight="800" fill="#ffffff">${escapeXml(vendor.store_name)}</text>
  <text x="28" y="76" font-size="15" fill="#ffe6cc">Menú destacado del día</text>
  <rect x="${W - 160}" y="24" width="132" height="40" rx="20" fill="#ffffff"/>
  <text x="${W - 94}" y="49" font-size="15" font-weight="800" fill="${ACCENT_DEEP}" text-anchor="middle">0% comisión</text>
</svg>`
      ),
      top: 0,
      left: 0,
    });

    for (let i = 0; i < products.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = PAD + col * (CELL_W + PAD);
      const y = TITLE_H + PAD + row * (CELL_H + PAD);

      // Fondo de la celda (card)
      const featured = products[i].featured_today === true;
      composites.push({
        input: Buffer.from(
          `<svg width="${CELL_W}" height="${CELL_H}">
  <rect x="0" y="0" width="${CELL_W}" height="${CELL_H}" rx="14" fill="#ffffff" stroke="${featured ? ACCENT_DEEP : "#e5e5e5"}" stroke-width="${featured ? 4 : 1.5}"/>
</svg>`
        ),
        top: y,
        left: x,
      });

      if (images[i] && images[i].length > 0) {
        composites.push({ input: images[i], top: y + 14, left: x + PAD });
      } else {
        composites.push({
          input: Buffer.from(
            `<svg width="${CELL_W - PAD * 2}" height="${IMG_H}"><rect x="0" y="0" width="100%" height="100%" fill="#efefef"/></svg>`
          ),
          top: y + 14,
          left: x + PAD,
        });
      }

      // Featured badge
      if (featured) {
        composites.push({
          input: Buffer.from(
            `<svg width="156" height="36"><rect x="0" y="0" width="156" height="36" rx="18" fill="${ACCENT_DEEP}"/><text x="78" y="24" text-anchor="middle" font-size="16" font-weight="800" fill="#ffffff">🔥 DESTACADA</text></svg>`
          ),
          top: y + 22,
          left: x + PAD + 4,
        });
      }

      const p = products[i];
      const price = p.promo_price != null ? Number(p.promo_price) : Number(p.price);
      const priceText = `$${Number(price).toLocaleString("es-AR")}`;
      const oldPriceText = p.promo_price != null ? `$${Number(p.price).toLocaleString("es-AR")}` : "";
      const name = String(p.name).slice(0, 42);
      composites.push({
        input: Buffer.from(
          `<svg width="${CELL_W}" height="${CELL_H - IMG_H - 24}">
  <text x="16" y="24" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="15" font-weight="800" fill="#1a1a1a">${escapeXml(name)}</text>
  <text x="16" y="52" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="19" font-weight="800" fill="${ACCENT_DEEP}">${escapeXml(priceText)}</text>
  ${oldPriceText ? `<line x1="16" y1="47" x2="${16 + oldPriceText.length * 9}" y2="47" stroke="#e63946" stroke-width="2"/>` : ""}
  ${oldPriceText ? `<text x="${16 + oldPriceText.length * 9 + 12}" y="52" font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="14" fill="#9ca3af">${escapeXml(oldPriceText)}</text>` : ""}
</svg>`
        ),
        top: y + IMG_H + 20,
        left: x,
      });
    }

    // Footer with link
    const host = getSiteUrl().replace(/^https?:\/\//, "").replace(/\/$/, "");
    composites.push({
      input: Buffer.from(
        `<svg width="${W}" height="${FOOTER_H}" font-family="DejaVu Sans, Liberation Sans, sans-serif">
  <text x="${W / 2}" y="32" text-anchor="middle" font-size="13" fill="#6b7280">Pedila online en ${escapeXml(host)}/tienda/${escapeXml(vendor.slug || "")}</text>
</svg>`
      ),
      top: TITLE_H + ROWS * CELL_H + (ROWS + 1) * PAD,
      left: 0,
    });

    const jpegBuffer = await canvas.composite(composites).jpeg({ quality: 84, mozjpeg: true }).toBuffer();

    return new NextResponse(new Uint8Array(jpegBuffer), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Error generando imagen" }, { status: 500 });
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
