import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ user: null });
  }

  const profile = await queryOne<{ phone: string | null; whatsapp: string | null; neighborhood: string | null }>(
    `SELECT phone, whatsapp, neighborhood FROM profiles WHERE id = $1`,
    [user.id]
  );

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