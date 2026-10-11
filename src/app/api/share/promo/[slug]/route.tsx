import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { NextResponse } from "next/server";
import { queryMany, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { isPreviewTokenValid } from "@/lib/preview";
import { discountOf, isValidPromo, promoMoney as money } from "@/lib/promo";

export const runtime = "nodejs";

// Sin fuentes custom: system-ui como la tarjeta de tienda (probada en prod).
// La fuente Roboto local con weight 700 vs textos en 800 tumbaba el render
// de satori y toda tarjeta promo caía al fallback. Ver historial.
async function ogJpeg(element: ReactElement): Promise<Response> {
  const res = new ImageResponse(element, {
    width: 1200,
    height: 630,
  });
  const png = Buffer.from(await res.arrayBuffer());
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(png)
    .flatten({ background: "#111111" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

type PromoProduct = {
  id: string;
  name: string;
  price: number;
  promo_price: number | null;
  promo_only: boolean | null;
  image_url: string | null;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const previewParam = new URL(request.url).searchParams.get("preview");

  const vendor = await queryOne<{
    store_name: string;
    image_url: string | null;
    logo_url: string | null;
    description: string | null;
    visible: boolean;
    preview_token: string | null;
    preview_token_expires_at: string | null;
  }>(
    `SELECT store_name, image_url, logo_url, description, visible, preview_token, preview_token_expires_at FROM vendors WHERE slug = $1 LIMIT 1`,
    [slug]
  );

  if (!vendor) {
    return new Response("Not found", { status: 404 });
  }

  const isPreview = !vendor.visible;
  if (isPreview && !isPreviewTokenValid(vendor, previewParam)) {
    return new Response("Not found", { status: 404 });
  }

  const storeName = vendor.store_name;
  const logoUrl = vendor.logo_url;
  const vendorDescription = vendor.description;
  const siteUrl = getSiteUrl();
  const domain = siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

  let manualImage: string | null = null;
  let selectedIds: string[] = [];
  let mode: "auto" | "manual" = "auto";
  try {
    try {
      const row = await queryOne<{ image_url: string; product_ids: unknown; mode: unknown }>(
        `SELECT image_url, product_ids, mode FROM vendor_promo_images WHERE vendor_id = (SELECT id FROM vendors WHERE slug = $1 LIMIT 1) LIMIT 1`,
        [slug]
      );
      manualImage = row?.image_url || null;
      if (row?.mode === "manual") mode = "manual";
      if (Array.isArray(row?.product_ids)) {
        selectedIds = (row?.product_ids as unknown[]).filter(
          (v): v is string => typeof v === "string"
        );
      }
    } catch {
      const legacy = await queryOne<{ image_url: string }>(
        `SELECT image_url FROM vendor_promo_images WHERE vendor_id = (SELECT id FROM vendors WHERE slug = $1 LIMIT 1) LIMIT 1`,
        [slug]
      );
      manualImage = legacy?.image_url || null;
    }
  } catch {
    try {
      const legacy = await queryOne<{ image_url: string }>(
        `SELECT image_url FROM vendor_promo_images WHERE vendor_id = (SELECT id FROM vendors WHERE slug = $1 LIMIT 1) LIMIT 1`,
        [slug]
      );
      manualImage = legacy?.image_url || null;
    } catch {
      manualImage = null;
    }
  }

  const W = 1200;
  const H = 630;
  const FONT = "system-ui, sans-serif";

  function ribbon() {
    if (!isPreview) return null;
    return (
      <div
        style={{
          position: "absolute",
          top: 36,
          right: 48,
          background: "#fbbf24",
          color: "#451a03",
          fontSize: 24,
          fontWeight: 800,
          padding: "8px 20px",
          borderRadius: 999,
        }}
      >
        MODO PRUEBA
      </div>
    );
  }

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

  // Tarjeta con foto manual del comercio (o banner): fondo foto + degradé,
  // píldora PROMO de texto (sin emoji: satori no trae fuente de emojis local).
  async function manualCard(banner: string | null) {
    const [bannerOk, logoOk] = await Promise.all([remoteOk(banner), remoteOk(logoUrl)]);
    const legend = vendorDescription || `Pedí por WhatsApp — Portal 659 · 0% comisión`;
    const backgroundImage = bannerOk && banner
      ? `url(${banner})`
      : `linear-gradient(135deg, #7f1d1d 0%, #b91c1c 55%, #ea580c 100%)`;
    return ogJpeg(
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          alignItems: "flex-start",
          padding: "48px 56px",
          backgroundImage,
          backgroundSize: "cover",
          backgroundPosition: "center",
          position: "relative",
          fontFamily: FONT,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.25) 55%, rgba(0,0,0,0) 100%)",
          }}
        />
        {ribbon()}
        <div
          style={{
            position: "absolute",
            top: 36,
            left: 48,
            background: "#ffffff",
            color: "#b91c1c",
            fontSize: 28,
            fontWeight: 800,
            padding: "10px 26px",
            borderRadius: 999,
          }}
        >
          PROMO
        </div>
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 24 }}>
          {logoOk && logoUrl && (
            <img
              src={logoUrl}
              width={160}
              height={160}
              style={{ borderRadius: 999, objectFit: "cover", border: "4px solid rgba(255,255,255,0.9)" }}
            />
          )}
          <div style={{ display: "flex", flexDirection: "column", color: "#fff" }}>
            <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.05, maxWidth: 900 }}>
              {storeName}
            </div>
            <div style={{ fontSize: 26, marginTop: 10, opacity: 0.92, maxWidth: 880 }}>
              {legend}
            </div>
            <div
              style={{
                marginTop: 20,
                display: "flex",
                fontSize: 22,
                fontWeight: 600,
                background: "rgba(255,255,255,0.16)",
                padding: "10px 18px",
                borderRadius: 999,
              }}
            >
              {domain} · Pedí directo por WhatsApp
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Tarjeta compuesta con productos: fondo promo + titular de descuento +
  // foto(s) elegidas por el comercio + logo del local.
  function composedCard(items: PromoProduct[], logoOk: boolean) {
    const best = Math.max(...items.map(discountOf));
    const hasOff = best > 0;
    const hero = items[0];
    const heroOff = discountOf(hero);
    const rest = items.slice(1);
    return ogJpeg(
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "row",
          position: "relative",
          backgroundImage: "linear-gradient(120deg, #7f1d1d 0%, #b91c1c 55%, #ea580c 100%)",
          fontFamily: FONT,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 880,
            top: -140,
            width: 420,
            height: 420,
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: -110,
            top: 400,
            width: 300,
            height: 300,
            borderRadius: 999,
            background: "rgba(0,0,0,0.12)",
          }}
        />
        {ribbon()}
        <div
          style={{
            position: "relative",
            width: 660,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "flex-start",
            padding: "48px 24px 48px 56px",
          }}
        >
          <div
            style={{
              display: "flex",
              background: "#ffffff",
              color: "#b91c1c",
              fontSize: 30,
              fontWeight: 800,
              padding: "10px 28px",
              borderRadius: 999,
            }}
          >
            PROMO
          </div>
          <div style={{ fontSize: 118, fontWeight: 800, color: "#ffffff", lineHeight: 1.05, marginTop: 8 }}>
            {hasOff ? `-${best}%` : "PROMO"}
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, color: "#ffffff", marginTop: 6, maxWidth: 560 }}>
            {hero.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14 }}>
            {heroOff > 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ fontSize: 30, color: "rgba(255,255,255,0.7)", textDecoration: "line-through" }}>
                  {money(hero.price)}
                </div>
                <div
                  style={{
                    display: "flex",
                    background: "#ffffff",
                    color: "#b91c1c",
                    fontSize: 40,
                    fontWeight: 800,
                    padding: "8px 24px",
                    borderRadius: 999,
                  }}
                >
                  {money(hero.promo_price!)}
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "flex",
                  background: "#ffffff",
                  color: "#b91c1c",
                  fontSize: 40,
                  fontWeight: 800,
                  padding: "8px 24px",
                  borderRadius: 999,
                }}
              >
                {money(hero.price)}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 22 }}>
            {logoOk && logoUrl && (
              <img
                src={logoUrl}
                width={76}
                height={76}
                style={{ borderRadius: 999, objectFit: "cover", border: "3px solid rgba(255,255,255,0.9)" }}
              />
            )}
            <div style={{ fontSize: 30, fontWeight: 700, color: "#ffffff" }}>{storeName}</div>
          </div>
          <div style={{ fontSize: 20, color: "rgba(255,255,255,0.85)", marginTop: 12 }}>
            {`${domain} · Pedí directo por WhatsApp`}
          </div>
        </div>
        <div
          style={{
            position: "relative",
            width: 540,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
            padding: 40,
          }}
        >
          {items.length === 1 ? (
            <div style={{ position: "relative", display: "flex" }}>
              {hero.image_url && (
                <img
                  src={hero.image_url}
                  width={400}
                  height={470}
                  style={{ borderRadius: 36, objectFit: "cover", border: "6px solid rgba(255,255,255,0.9)" }}
                />
              )}
              {heroOff > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: 24,
                    left: 24,
                    width: 124,
                    height: 124,
                    borderRadius: 999,
                    background: "#ffffff",
                    color: "#b91c1c",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 36,
                    fontWeight: 800,
                  }}
                >
                  -{heroOff}%
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 20 }}>
              <div style={{ position: "relative", display: "flex" }}>
                {hero.image_url && (
                  <img
                    src={hero.image_url}
                    width={items.length > 2 ? 260 : 250}
                    height={400}
                    style={{ borderRadius: 32, objectFit: "cover", border: "6px solid rgba(255,255,255,0.9)" }}
                  />
                )}
                {heroOff > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: 20,
                      left: 20,
                      width: 112,
                      height: 112,
                      borderRadius: 999,
                      background: "#ffffff",
                      color: "#b91c1c",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 33,
                      fontWeight: 800,
                    }}
                  >
                    -{heroOff}%
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {rest.slice(0, 2).map((p) =>
                  p.image_url ? (
                    <img
                      key={p.id}
                      src={p.image_url}
                      width={items.length > 2 ? 200 : 230}
                      height={items.length > 2 ? 190 : 190}
                      style={{ borderRadius: 28, objectFit: "cover", border: "5px solid rgba(255,255,255,0.9)" }}
                    />
                  ) : null
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Tarjeta de texto cuando hay promos pero sin fotos: titular de
  // descuento + producto + precios + logo sobre fondo promo.
  function textOnlyCard(items: PromoProduct[], logoOk: boolean) {
    const best = Math.max(...items.map(discountOf));
    const hasOff = best > 0;
    const hero = items[0];
    const heroOff = discountOf(hero);
    const extra = items.length > 1 ? ` +${items.length - 1} más` : "";
    return ogJpeg(
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          position: "relative",
          backgroundImage: "linear-gradient(135deg, #7f1d1d 0%, #b91c1c 55%, #ea580c 100%)",
          fontFamily: FONT,
          padding: "48px 64px",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 880,
            top: -140,
            width: 420,
            height: 420,
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
          }}
        />
        {ribbon()}
        <div
          style={{
            display: "flex",
            background: "#ffffff",
            color: "#b91c1c",
            fontSize: 30,
            fontWeight: 800,
            padding: "10px 28px",
            borderRadius: 999,
          }}
        >
          PROMO
        </div>
        <div style={{ fontSize: 110, fontWeight: 800, color: "#ffffff", lineHeight: 1.05, marginTop: 8 }}>
          {hasOff ? `-${best}%` : "PROMO"}
        </div>
        <div style={{ fontSize: 34, fontWeight: 700, color: "#ffffff", marginTop: 6 }}>
          {`${hero.name}${extra}`}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14 }}>
          {heroOff > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ fontSize: 30, color: "rgba(255,255,255,0.7)", textDecoration: "line-through" }}>
                {money(hero.price)}
              </div>
              <div
                style={{
                  display: "flex",
                  background: "#ffffff",
                  color: "#b91c1c",
                  fontSize: 40,
                  fontWeight: 800,
                  padding: "8px 24px",
                  borderRadius: 999,
                }}
              >
                {money(hero.promo_price!)}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                background: "#ffffff",
                color: "#b91c1c",
                fontSize: 40,
                fontWeight: 800,
                padding: "8px 24px",
                borderRadius: 999,
              }}
            >
              {money(hero.price)}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 20 }}>
          {logoOk && logoUrl && (
            <img
              src={logoUrl}
              width={68}
              height={68}
              style={{ borderRadius: 999, objectFit: "cover", border: "3px solid rgba(255,255,255,0.9)" }}
            />
          )}
          <div style={{ fontSize: 28, fontWeight: 700, color: "#ffffff" }}>{storeName}</div>
        </div>
      </div>
    );
  }

  // Diagnóstico sin adivinar: /og/promo/<slug>.jpg?debug=1 devuelve el
  // conteo (productos válidos, elegidos, fotos ok, modo). Los mismos datos
  // que ve la landing /promo (públicos), sin exponer nada privado.
  if (new URL(request.url).searchParams.get("debug") === "1") {
    const diag = await queryMany<{
      id: string;
      name: string;
      price: number;
      promo_price: number | null;
      promo_only: boolean | null;
      available: boolean;
      image_url: string | null;
    }>(
      `SELECT id, name, price, promo_price, promo_only, available, image_url FROM products
       WHERE vendor_id = (SELECT id FROM vendors WHERE slug = $1 LIMIT 1)`,
      [slug]
    ).catch(() => []);
    const diagListed = (diag || []).filter(
      (p) => p.promo_price != null || p.promo_only === true
    );
    const diagById = new Map(diagListed.map((p) => [p.id, p]));
    const diagPicked = selectedIds
      .map((id) => diagById.get(id))
      .filter((p): p is (typeof diagListed)[number] => !!p)
      .slice(0, 3);
    const diagAuto = [
      ...diagListed.filter(isValidPromo).sort((a, b) => discountOf(b) - discountOf(a)),
      ...diagListed.filter((p) => !isValidPromo(p)),
    ].slice(0, 3);
    const diagList = diagPicked.length > 0 ? diagPicked : diagAuto;
    const diagValid = diagListed.filter(isValidPromo);
    const diagPhotos = await Promise.all(
      diagList.map(async (p) => ({ id: p.id, photo: !!p.image_url, ok: await remoteOk(p.image_url) }))
    );
    return NextResponse.json({
      code: "promo-og-v3-nofont",
      uptimeSec: Math.round(process.uptime()),
      slug,
      visible: vendor.visible,
      mode,
      manualImage: !!manualImage,
      selection: selectedIds,
      productsTotal: (diag || []).length,
      productsValid: diagValid.map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        promoPrice: p.promo_price != null ? Number(p.promo_price) : null,
        promoOnly: !!p.promo_only,
        available: p.available,
        hasPhoto: !!p.image_url,
        hasDiscount: isValidPromo(p),
        discount: discountOf(p),
      })),
      picked: diagList.map((p) => p.id),
      photos: diagPhotos,
    });
  }

  // Datos + validación de fotos, compartido por el render y el debug.
  async function resolvePicked(): Promise<{
    picked: PromoProduct[];
    logoOk: boolean;
    photoOk: boolean[];
  }> {
    const all = await queryMany<PromoProduct>(
      `SELECT id, name, price, promo_price, promo_only, image_url FROM products
       WHERE vendor_id = (SELECT id FROM vendors WHERE slug = $1 LIMIT 1)
         AND available = true
         AND (promo_price IS NOT NULL OR promo_only = true)`,
      [slug]
    );
    const valid = all || [];
    const byId = new Map(valid.map((p) => [p.id, p]));
    let picked = selectedIds
      .map((id) => byId.get(id))
      .filter((p): p is PromoProduct => !!p)
      .slice(0, 3);
    if (picked.length === 0) {
      // Descuentos reales primero, promo_only sin descuento después.
      const withOff = valid.filter(isValidPromo).sort((a, b) => discountOf(b) - discountOf(a));
      const rest = valid.filter((p) => !isValidPromo(p));
      picked = [...withOff, ...rest].slice(0, 3);
    }
    const urls = [logoUrl, ...picked.map((p) => p.image_url)];
    const checks = await Promise.all(urls.map((u) => remoteOk(u)));
    return { picked, logoOk: checks[0], photoOk: checks.slice(1) };
  }

  // Render real expuesto como JSON: prueba la rama exacta que se serviría
  // y devuelve el error de satori/sharp en el cuerpo (sin depender de logs).
  if (new URL(request.url).searchParams.get("debug") === "render") {
    let stage = "data";
    try {
      if (mode === "manual" && manualImage) {
        const res = await manualCard(manualImage);
        const buf = await res.arrayBuffer();
        return NextResponse.json({ code: "promo-og-v3", render: "ok", branch: "manual", bytes: buf.byteLength });
      }
      const { picked, logoOk, photoOk } = await resolvePicked();
      const withPhoto = picked.filter((_, i) => photoOk[i]);
      let branch = "fallback-empty";
      if (picked.length > 0 && withPhoto.length === 0) branch = "text";
      else if (withPhoto.length > 0) branch = "composed";
      stage = `render:${branch}`;
      let res: Response;
      if (branch === "fallback-empty") res = await manualCard(manualImage || vendor.image_url);
      else if (branch === "text") res = await textOnlyCard(picked, logoOk);
      else res = await composedCard(withPhoto, logoOk);
      const buf = await res.arrayBuffer();
      return NextResponse.json({ code: "promo-og-v3", render: "ok", branch, bytes: buf.byteLength });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return NextResponse.json(
        {
          code: "promo-og-v3",
          render: "error",
          stage,
          message: err.message,
          stack: String(err.stack || "")
            .split("\n")
            .slice(0, 8),
        },
        { status: 500 }
      );
    }
  }

  try {
    // 1) Modo manual con foto: manda la foto del comercio.
    if (mode === "manual" && manualImage) {
      console.log("[share-promo] tarjeta manual", { slug });
      return await manualCard(manualImage);
    }

    // 2) Composición con productos: selección del comercio o top-3 automático.
    const { picked, logoOk, photoOk } = await resolvePicked();
    if (picked.length === 0) {
      console.error("[share-promo] sin productos en promo, fallback", {
        slug,
        mode,
        selectedIds,
      });
      return await manualCard(manualImage || vendor.image_url);
    }

    const withPhoto = picked.filter((_, i) => photoOk[i]);
    // Sin fotos accesibles: tarjeta de texto (nunca cae en silencio a la vieja).
    if (withPhoto.length === 0) {
      console.log("[share-promo] tarjeta texto (sin fotos)", {
        slug,
        picked: picked.map((p) => p.id),
      });
      return await textOnlyCard(picked, logoOk);
    }
    console.log("[share-promo] tarjeta compuesta", {
      slug,
      picked: withPhoto.map((p) => p.id),
      logoOk,
    });
    return await composedCard(withPhoto, logoOk);
  } catch (err) {
    console.error("[share-promo] fallo render, usando fallback:", err);
    return ogJpeg(
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          alignItems: "flex-start",
          padding: "48px 56px",
          backgroundImage: "linear-gradient(135deg, #7f1d1d 0%, #b91c1c 55%, #ea580c 100%)",
          position: "relative",
          fontFamily: FONT,
        }}
      >
        {ribbon()}
        <div
          style={{
            position: "absolute",
            top: 36,
            left: 48,
            background: "#ffffff",
            color: "#b91c1c",
            fontSize: 28,
            fontWeight: 800,
            padding: "10px 26px",
            borderRadius: 999,
          }}
        >
          PROMO
        </div>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", color: "#fff" }}>
          <div style={{ fontSize: 52, fontWeight: 800 }}>{storeName}</div>
          <div style={{ fontSize: 26, marginTop: 10, opacity: 0.92 }}>
            Promos exclusivas · Pedí directo por WhatsApp
          </div>
        </div>
      </div>
    );
  }
}
