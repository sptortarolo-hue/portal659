import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";

/**
 * Imagen compartible de una tarjeta de regalo (logo + comercio + valor +
 * código + vigencia). Mismo pipeline que las tarjetas OG: satori → JPEG
 * liviano (WhatsApp) + fallback a gradiente si falla el logo.
 * El código es la autorización (no se indexa, no se lista en ningún lado).
 */
async function ogJpeg(element: ReactElement): Promise<Response> {
  const res = new ImageResponse(element, { width: 1200, height: 630 });
  const png = Buffer.from(await res.arrayBuffer());
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(png)
    .flatten({ background: "#1e1b4b" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const clean = String(code || "").trim().toUpperCase();
  if (!clean) return new Response("Not found", { status: 404 });

  const card = await queryOne<{
    code: string;
    amount: number;
    status: string;
    expires_at: string | null;
    vendor_id: string;
  }>(
    `SELECT code, amount, status, expires_at::text AS expires_at, vendor_id
     FROM giftcards WHERE code = $1 LIMIT 1`,
    [clean]
  ).catch(() => null);
  if (!card) return new Response("Not found", { status: 404 });

  const vendor = await queryOne<{ store_name: string; logo_url: string | null }>(
    `SELECT store_name, logo_url FROM vendors WHERE id = $1 LIMIT 1`,
    [card.vendor_id]
  ).catch(() => null);

  const storeName = vendor?.store_name || "Tu comercio";
  const logo = vendor?.logo_url || null;
  const amount = `$${Math.round(Number(card.amount) || 0).toLocaleString("es-AR")}`;
  const expRaw = String(card.expires_at || "").slice(0, 10);
  const expM = expRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const vence = expM ? `${expM[3]}/${expM[2]}/${expM[1]}` : null;

  async function remoteOk(url: string | null): Promise<boolean> {
    if (!url) return true;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return false;
      await res.arrayBuffer().catch(() => null);
      return true;
    } catch {
      return false;
    }
  }
  const logoOk = await remoteOk(logo);

  const body = (withLogo: boolean) => (
    <div
      style={{
        width: 1200,
        height: 630,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 56,
        padding: "56px 64px",
        background: "linear-gradient(135deg, #1e1b4b 0%, #6b21a8 55%, #a21caf 100%)",
        position: "relative",
        fontFamily: "system-ui, sans-serif",
        color: "#fff",
      }}
    >
      {withLogo && logo ? (
        <img
          src={logo}
          width={280}
          height={280}
          style={{ borderRadius: 999, objectFit: "cover", border: "8px solid rgba(255,255,255,0.9)" }}
        />
      ) : (
        <div style={{ fontSize: 220, lineHeight: 1 }}>🎁</div>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4, opacity: 0.75 }}>
          TARJETA DE REGALO
        </div>
        <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1, marginTop: 6 }}>{storeName}</div>
        <div style={{ fontSize: 96, fontWeight: 900, marginTop: 12 }}>{amount}</div>
        <div
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 30,
          }}
        >
          <span style={{ fontFamily: "monospace", fontWeight: 800, background: "rgba(0,0,0,0.35)", padding: "10px 22px", borderRadius: 16 }}>
            {card.code}
          </span>
          <span style={{ opacity: 0.85 }}>{vence ? `Válida hasta el ${vence}` : "Sin vencimiento"}</span>
        </div>
      </div>
    </div>
  );

  try {
    if (!logoOk) throw new Error("remote image unavailable");
    return ogJpeg(body(true));
  } catch (err) {
    console.error("[share] giftcard: fallo render con logo, usando fallback:", err);
    return ogJpeg(body(false));
  }
}
