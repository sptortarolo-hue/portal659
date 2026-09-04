import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

// Vinculación por código: el repartidor ingresa el código que le da el comercio
// y queda ligado como vendor_staff.role='delivery' a ese vendor.
export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const code = (body.code ?? "").trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "Ingresá el código de vinculación" }, { status: 400 });

  const vendor = await queryOne<{ id: string; store_name: string }>(
    `SELECT id, store_name FROM vendors WHERE link_code = $1 LIMIT 1`,
    [code]
  );
  if (!vendor) {
    return NextResponse.json({ error: "Código inválido o vencido" }, { status: 404 });
  }

  const exists = await queryOne<{ id: string }>(
    `SELECT id FROM vendor_staff WHERE vendor_id = $1 AND profile_id = $2 LIMIT 1`,
    [vendor.id, user.id]
  );

  if (exists) {
    return NextResponse.json({ ok: true, alreadyLinked: true, vendor: { id: vendor.id, store_name: vendor.store_name } });
  }

  await query(
    `INSERT INTO vendor_staff (vendor_id, profile_id, role) VALUES ($1, $2, 'delivery')`,
    [vendor.id, user.id]
  );

  return NextResponse.json({ ok: true, vendor: { id: vendor.id, store_name: vendor.store_name } });
}