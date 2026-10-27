import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { query, queryMany, queryOne } from "@/lib/db";

/**
 * GET /api/wa/favorites?phone= — lista de tiendas favoritas del teléfono.
 * POST /api/wa/favorites { phone, vendorId } — agrega un favorito.
 * DELETE /api/wa/favorites { phone, vendorId } — quita un favorito.
 */
export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const url = new URL(request.url);
  const phone = (url.searchParams.get("phone") || "").replace(/\D/g, "");
  if (phone.length < 6) {
    return NextResponse.json({ error: "phone requerido" }, { status: 400 });
  }
  const rows = await queryMany<{ vendor_id: string; store_name: string; slug: string | null }>(
    `SELECT f.vendor_id, v.store_name, v.slug
     FROM wa_customer_favorites f
     JOIN vendors v ON v.id = f.vendor_id
     WHERE f.phone = $1
     ORDER BY f.created_at ASC`,
    [phone]
  ).catch(() => []);
  return NextResponse.json({ favorites: rows || [] });
}

export async function POST(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  let body: any;
  try { body = await request.json(); } catch { body = null; }
  const phone = String(body?.phone || "").replace(/\D/g, "");
  const vendorId = String(body?.vendorId || "");
  if (phone.length < 6 || !vendorId) {
    return NextResponse.json({ error: "phone y vendorId requeridos" }, { status: 400 });
  }
  // Verificar que el vendor existe y es visible.
  const v = await queryOne<{ id: string }>(`SELECT id FROM vendors WHERE id = $1 AND COALESCE(visible, true) = true LIMIT 1`, [vendorId]);
  if (!v) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  await query(
    `INSERT INTO wa_customer_favorites (phone, vendor_id) VALUES ($1, $2) ON CONFLICT (phone, vendor_id) DO NOTHING`,
    [phone, vendorId]
  ).catch(() => {});
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  let body: any;
  try { body = await request.json(); } catch { body = null; }
  const phone = String(body?.phone || "").replace(/\D/g, "");
  const vendorId = String(body?.vendorId || "");
  if (phone.length < 6 || !vendorId) {
    return NextResponse.json({ error: "phone y vendorId requeridos" }, { status: 400 });
  }
  await query(`DELETE FROM wa_customer_favorites WHERE phone = $1 AND vendor_id = $2`, [phone, vendorId]).catch(() => {});
  return NextResponse.json({ ok: true });
}
