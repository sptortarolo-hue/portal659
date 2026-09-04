import { NextResponse } from "next/server";
import { query, queryMany, queryOne } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { generateLinkCode } from "@/lib/link-code";

type StaffRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  created_at: string;
};

// Lista los repartidores vinculados al comercio.
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const staff = await queryMany<StaffRow>(
    `SELECT vs.id, p.full_name, p.email, vs.role, vs.created_at
     FROM vendor_staff vs
     JOIN profiles p ON p.id = vs.profile_id
     WHERE vs.vendor_id = $1
     ORDER BY vs.created_at ASC`,
    [vendor.id]
  );

  const v = await queryOne<{ link_code: string | null }>(
    `SELECT link_code FROM vendors WHERE id = $1 LIMIT 1`,
    [vendor.id]
  );

  return NextResponse.json({ staff, linkCode: v?.link_code ?? null });
}

// POST: generar/regenerar código de vinculación { action: "code" }
export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const action = body.action ?? "code";

  if (action === "code") {
    const code = generateLinkCode();
    await query(`UPDATE vendors SET link_code = $1 WHERE id = $2`, [code, vendor.id]);
    return NextResponse.json({ ok: true, linkCode: code });
  }

  return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}

// DELETE ?id=staffId → desvincula un repartidor.
export async function DELETE(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const url = new URL(request.url);
  const staffId = url.searchParams.get("id") ?? "";
  if (!staffId) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  await query(`DELETE FROM vendor_staff WHERE id = $1 AND vendor_id = $2`, [staffId, vendor.id]);
  return NextResponse.json({ ok: true });
}