import { isAdmin } from "@/lib/admin-utils";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Admin: número WA central de Portal 659 (para avisar a la logística).
 * - GET: estado del número central (vinculado/no, teléfono, status del relay).
 * - POST { action: "ensure" }: crea el vendor central si no existe
 *   (user_id = admin actual) y devuelve su id. Idempotente.
 */
export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  try {
    const vendor = await queryOne<{ id: string }>(
      `SELECT id FROM vendors WHERE is_portal = true LIMIT 1`
    );
    if (!vendor) {
      return NextResponse.json({ vendorId: null, linked: false, waPhone: null, status: null, enabled: false });
    }
    let bot: { status: string | null; enabled: boolean; wa_phone: string | null } | null = null;
    try {
      const row = await queryOne<{ status: string | null; enabled: boolean; wa_phone: string | null }>(
        `SELECT status, enabled, wa_phone FROM vendor_wa_bots WHERE vendor_id = $1 LIMIT 1`,
        [vendor.id]
      );
      bot = row ?? null;
    } catch {
      /* tabla vendor_wa_bots sin migrar */
    }
    return NextResponse.json({
      vendorId: vendor.id,
      linked: !!bot && bot.status === "linked" && bot.enabled !== false,
      waPhone: bot?.wa_phone || null,
      status: bot?.status || null,
      enabled: bot?.enabled !== false,
    });
  } catch {
    // Migración sin aplicar (columna is_portal no existe).
    return NextResponse.json({ vendorId: null, linked: false, waPhone: null, status: null, enabled: false, ready: false });
  }
}

export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "").trim();
  if (action !== "ensure") {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  try {
    // Buscar vendor central existente.
    let vendor = await queryOne<{ id: string }>(
      `SELECT id FROM vendors WHERE is_portal = true LIMIT 1`
    );
    if (!vendor) {
      // Crear vendor central con user_id = admin actual.
      vendor = await queryOne<{ id: string }>(
        `INSERT INTO vendors (user_id, store_name, slug, vertical, is_portal)
         VALUES ($1, 'Portal 659 (número central)', 'portal-central', 'comercio', true)
         ON CONFLICT (slug) DO UPDATE SET is_portal = true
         RETURNING id`,
        [user.id]
      );
    }
    if (!vendor) {
      return NextResponse.json({ error: "No se pudo crear el vendor central" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, vendorId: vendor.id });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-portal-wa.sql (columna is_portal)" },
      { status: 503 }
    );
  }
}
