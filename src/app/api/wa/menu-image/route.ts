import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { queryMany, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";

/**
 * GET /api/wa/menu-image?vendorId=X — genera una imagen (JPEG) con collage de
 * los productos principales de un comercio (foto + nombre + precio). Lo usa el
 * bot del portal para enviar el menú visual por WhatsApp.
 */
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
    `SELECT id, name, price, promo_price, image_url, category
     FROM products WHERE vendor_id = $1 AND available = true AND image_url IS NOT NULL
     ORDER BY featured_today DESC, name ASC
     LIMIT 4`,
    [vendorId]
  ).catch(() => []);

  if (!products || products.length === 0) {
    return NextResponse.json({ error: "Sin productos con imagen" }, { status: 404 });
  }

  try {
    const sharp = (await import("sharp")).default;
    const COLS = products.length <= 2 ? products.length : 2;
    const ROWS = Math.ceil(products.length / COLS);
    const CELL_W = 400;
    const CELL_H = 320;
    const IMG_H = 220;
    const PAD = 16;
    const WIDTH = COLS * CELL_W + (COLS + 1) * PAD;
    const HEIGHT = ROWS * CELL_H + (ROWS + 1) * PAD + 60; // +60 for title

    // Descargar imágenes de los productos.
    const images: Buffer[] = [];
    for (const p of products) {
      try {
        const res = await fetch(p.image_url, { signal: AbortSignal.timeout(8_000) });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const resized = await sharp(buf).resize(CELL_W - PAD * 2, IMG_H, { fit: "cover" }).toBuffer();
          images.push(resized);
        } else {
          images.push(Buffer.alloc(0));
        }
      } catch {
        images.push(Buffer.alloc(0));
      }
    }

    // Crear canvas con fondo blanco.
    const canvas = sharp({
      create: { width: WIDTH, height: HEIGHT, channels: 3, background: { r: 255, g: 255, b: 255 } },
    });

    // Componer las imágenes y texto.
    const composites: any[] = [];

    // Título.
    const titleSvg = `<svg width="${WIDTH}" height="60"><text x="${WIDTH / 2}" y="38" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="bold" fill="#333">${escapeXml(vendor.store_name)} — Menú</text></svg>`;
    composites.push({ input: Buffer.from(titleSvg), top: 0, left: 0 });

    for (let i = 0; i < products.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = PAD + col * (CELL_W + PAD);
      const y = 60 + PAD + row * (CELL_H + PAD);

      // Imagen del producto.
      if (images[i] && images[i].length > 0) {
        composites.push({ input: images[i], top: y, left: x + PAD });
      } else {
        // Placeholder gris.
        const placeholder = await sharp({ create: { width: CELL_W - PAD * 2, height: IMG_H, channels: 3, background: { r: 220, g: 220, b: 220 } } }).png().toBuffer();
        composites.push({ input: placeholder, top: y, left: x + PAD });
      }

      // Texto: nombre + precio.
      const p = products[i];
      const price = p.promo_price != null ? Number(p.promo_price) : Number(p.price);
      const origPrice = p.promo_price != null ? ` (antes $${Number(p.price).toLocaleString("es-AR")})` : "";
      const name = String(p.name).slice(0, 30);
      const priceText = `$${price.toLocaleString("es-AR")}${origPrice}`;
      const textSvg = `<svg width="${CELL_W}" height="${CELL_H - IMG_H}"><text x="${PAD}" y="24" font-family="sans-serif" font-size="14" font-weight="bold" fill="#333">${escapeXml(name)}</text><text x="${PAD}" y="46" font-family="sans-serif" font-size="13" fill="#e63946">${escapeXml(priceText)}</text></svg>`;
      composites.push({ input: Buffer.from(textSvg), top: y + IMG_H, left: x });
    }

    const jpegBuffer = await canvas.composite(composites).jpeg({ quality: 85 }).toBuffer();

    return new NextResponse(jpegBuffer, {
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
