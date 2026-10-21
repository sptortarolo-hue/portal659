import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { query, queryMany, queryOne } from "@/lib/db";
import { getDeviceId } from "@/lib/device";
import { mergeDeviceFavorites } from "@/lib/device-merge";

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ user: null });
  }

  const deviceId = getDeviceId(request);
  if (deviceId) {
    await mergeDeviceFavorites(user.id, deviceId);
  }

  const profile = await queryOne<{ phone: string | null; whatsapp: string | null; neighborhood: string | null }>(
    `SELECT phone, whatsapp, neighborhood FROM profiles WHERE id = $1`,
    [user.id]
  );

  const owned = await queryMany<{
    id: string;
    slug: string | null;
    store_name: string;
    logo_url: string | null;
    image_url: string | null;
    vertical: string | null;
    plan_id: string | null;
    plan_status: string | null;
  }>(
    `SELECT id, slug, store_name, logo_url, image_url, vertical, plan_id, plan_status
     FROM vendors WHERE user_id = $1 ORDER BY created_at ASC LIMIT 20`,
    [user.id]
  );
  // Multi-tienda: activo = cookie `portal659-vendor-id` (validada como
  // propia) o el primero del dueño. Igual que getVendorByRequest.
  const cookieHeader = request.headers.get("cookie") || "";
  let wantVendorId: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === "portal659-vendor-id") wantVendorId = rest.join("=").trim() || null;
  }
  const active =
    (wantVendorId ? owned.find((v) => v.id === wantVendorId) : null) ?? owned[0] ?? null;

  // Staff: si no es dueño pero está vinculado activo a un comercio
  // (repartidor o usuario del local). Tolerante a migración sin aplicar.
  let staff: {
    role: string;
    store_name: string;
    vendor_id: string;
    staff_level?: string | null;
    display_name?: string | null;
    username?: string | null;
  } | null = null;
  try {
    staff =
      (await queryOne<{
        role: string;
        store_name: string;
        vendor_id: string;
        staff_level: string | null;
        display_name: string | null;
        username: string | null;
      }>(
        `SELECT vs.role, v.store_name, v.id AS vendor_id, vs.staff_level, vs.display_name, vs.username
         FROM vendor_staff vs
         JOIN vendors v ON v.id = vs.vendor_id
         WHERE vs.profile_id = $1 AND vs.status = 'active' AND vs.role IN ('delivery', 'staff')
         LIMIT 1`,
        [user.id]
      )) ?? null;
  } catch {
    staff =
      (await queryOne<{
        role: string;
        store_name: string;
        vendor_id: string;
      }>(
        `SELECT vs.role, v.store_name, v.id AS vendor_id
         FROM vendor_staff vs
         JOIN vendors v ON v.id = vs.vendor_id
         WHERE vs.profile_id = $1 AND vs.status = 'active' AND vs.role = 'delivery'
         LIMIT 1`,
        [user.id]
      )) ?? null;
  }

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.full_name || user.email,
      full_name: user.full_name,
      phone: profile?.phone || "",
      whatsapp: profile?.whatsapp || "",
      neighborhood: profile?.neighborhood || "",
      is_admin: user.is_admin,
      role: user.role,
    },
    vendor: active,
    vendors: owned,
    staff: staff || null,
  });
}

export async function PATCH(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { full_name, phone, whatsapp, neighborhood } = body || {};

  const updates: Record<string, string | null> = {};
  if (typeof full_name === "string") updates.full_name = full_name.trim() || null;
  if (typeof phone === "string") updates.phone = phone.trim() || null;
  if (typeof whatsapp === "string") updates.whatsapp = whatsapp.trim() || null;
  if (typeof neighborhood === "string") updates.neighborhood = neighborhood.trim() || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
  }

  try {
    await query(
      `UPDATE profiles SET full_name = $1, phone = $2, whatsapp = $3, neighborhood = $4 WHERE id = $5`,
      [updates.full_name ?? null, updates.phone ?? null, updates.whatsapp ?? null, updates.neighborhood ?? null, user.id]
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Error al actualizar" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}