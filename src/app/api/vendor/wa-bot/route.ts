import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { query, queryOne } from "@/lib/db";

async function resolveBotVendor(request: Request, user: { is_admin?: boolean }): Promise<{ id: string; user_id: string | null } | null> {
  const { vendor } = await getVendorByRequest(request);
  if (vendor) return vendor;
  if (user?.is_admin) {
    // El bot vive en un vendor de sistema (invisible en listados). El admin
    // lo gestiona acá aunque no sea su tienda activa.
    return await queryOne<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM vendors WHERE slug IN ('portal659-bot','admin-portal659','portal-central') LIMIT 1`
    ) ?? null;
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const vendor = await resolveBotVendor(request, user);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const staffRole = null;

  const bot = await queryOne(
    `SELECT wa_phone, status, enabled, token, created_at, updated_at
     FROM vendor_wa_bots WHERE vendor_id = $1`,
    [vendor.id]
  );
  return NextResponse.json({ bot: bot || null });
}

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const vendor = await resolveBotVendor(request, user);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const token = "wa_" + randomBytes(24).toString("base64url");
  await query(
    `INSERT INTO vendor_wa_bots (vendor_id, token) VALUES ($1, $2)
     ON CONFLICT (vendor_id) DO UPDATE SET token = $2, updated_at = now()`,
    [vendor.id, token]
  );
  return NextResponse.json({ ok: true, token });
}

export async function PATCH(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const vendor = await resolveBotVendor(request, user);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { enabled, wa_phone } = body as { enabled?: boolean; wa_phone?: string };

  const setParts: string[] = [];
  const params: unknown[] = [vendor.id];
  if (typeof enabled === "boolean") { params.push(enabled); setParts.push(`enabled = $${params.length}`); }
  if (typeof wa_phone === "string") { params.push(wa_phone.replace(/\D/g, "")); setParts.push(`wa_phone = $${params.length}`); }
  if (setParts.length === 0) return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });

  await query(
    `UPDATE vendor_wa_bots SET ${setParts.join(", ")}, updated_at = now() WHERE vendor_id = $1`,
    params
  );
  return NextResponse.json({ ok: true });
}