import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany } from "@/lib/db";

type Op = "pct_up" | "pct_down" | "add" | "set";

/**
 * Modificación masiva de precios de la carta (estilo Fudo): un solo UPDATE
 * por comercio en vez de N PATCHes desde el cliente. Sobre `price`
 * (las promos `promo_price` no se tocan).
 *
 * Body: { ids: string[], op: "pct_up" | "pct_down" | "add" | "set", value: number }
 * - pct_up/pct_down: porcentaje (0–500), redondeado a entero (moneda local).
 * - add: suma fija ($). value puede ser 0..1e9.
 * - set: precio fijo para todos.
 */
export async function POST(request: Request) {
  const { vendor, staffRole } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }
  if (staffRole === "delivery") {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  let body: { ids?: unknown; op?: unknown; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  const op = String(body.op || "") as Op;
  const value = Number(body.value);

  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "Sin productos seleccionados" }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ ok: false, error: "Máximo 500 productos por vez" }, { status: 400 });
  }
  if (!["pct_up", "pct_down", "add", "set"].includes(op)) {
    return NextResponse.json({ ok: false, error: "Operación inválida" }, { status: 400 });
  }
  if (!isFinite(value) || value < 0 || value > 1e9) {
    return NextResponse.json({ ok: false, error: "Valor inválido" }, { status: 400 });
  }
  if ((op === "pct_up" || op === "pct_down") && value > 500) {
    return NextResponse.json({ ok: false, error: "Porcentaje fuera de rango (0–500)" }, { status: 400 });
  }

  const expr =
    op === "pct_up"
      ? "ROUND(price * (100.0 + $2) / 100.0)"
      : op === "pct_down"
        ? "ROUND(price * (100.0 - $2) / 100.0)"
        : op === "add"
          ? "price + $2"
          : "$2";

  // Las tarjetas van atadas a su monto: la operación masiva no las toca.
  // Tolerante a DBs sin columna sku (migración sin aplicar): reintenta legacy.
  let rows: { id: string }[];
  try {
    rows = await queryMany<{ id: string }>(
      `UPDATE products
          SET price = GREATEST(0, ${expr})
         WHERE vendor_id = $1 AND id = ANY($3::uuid[])
           AND NOT (COALESCE(sku, '') LIKE 'GC-%' OR lower(COALESCE(category, '')) = 'giftcards')
         RETURNING id`,
      [vendor.id, value, ids]
    );
  } catch {
    rows = await queryMany<{ id: string }>(
      `UPDATE products
          SET price = GREATEST(0, ${expr})
         WHERE vendor_id = $1 AND id = ANY($3::uuid[])
         RETURNING id`,
      [vendor.id, value, ids]
    );
  }

  // Los precios cambiaron: mover el versionado de la tarjeta promo (?v=).
  if (rows.length > 0) {
    const { touchPromoVersion } = await import("@/lib/promo-server");
    await touchPromoVersion(vendor.id);
  }

  return NextResponse.json({ ok: true, updated: rows.length });
}
