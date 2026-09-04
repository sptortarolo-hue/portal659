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
  status: string;
  phone: string | null;
  invite_code: string | null;
  created_at: string;
};

function normalizePhone(input: string): string {
  return (input || "").replace(/\D/g, "").trim();
}

// Lista los repartidores del comercio con su estado.
export async function GET(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const staff = await queryMany<StaffRow>(
    `SELECT vs.id, p.full_name, p.email, vs.role, vs.status, vs.phone, vs.invite_code, vs.created_at
     FROM vendor_staff vs
     LEFT JOIN profiles p ON p.id = vs.profile_id
     WHERE vs.vendor_id = $1
     ORDER BY vs.created_at ASC`,
    [vendor.id]
  );

  return NextResponse.json({ staff });
}

// POST { action: "add" } → crea un repartidor (nombre + teléfono) con código único.
// POST { action: "regenerate", id } → nuevo código para un repartidor (pierde el anterior).
export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const action = body.action ?? "add";

  if (action === "add") {
    const phone = normalizePhone(String(body.phone ?? ""));
    const name = String(body.name ?? "").trim();
    if (!phone) return NextResponse.json({ error: "El teléfono es obligatorio" }, { status: 400 });
    if (phone.length < 8) return NextResponse.json({ error: "Teléfono inválido" }, { status: 400 });

    // Evitar duplicar repartidores activos/pendientes con el mismo teléfono.
    const dup = await queryOne<{ id: string }>(
      `SELECT id FROM vendor_staff
       WHERE vendor_id = $1 AND phone = $2 AND status <> 'revoked' LIMIT 1`,
      [vendor.id, phone]
    );
    if (dup) {
      return NextResponse.json({ error: "Ese teléfono ya tiene un repartidor activo/pendiente" }, { status: 409 });
    }

    const code = generateLinkCode();
    const row = await queryOne<{ id: string; invite_code: string; phone: string }>(
      `INSERT INTO vendor_staff (vendor_id, role, invite_code, phone, status)
       VALUES ($1, 'delivery', $2, $3, 'pending')
       RETURNING id, invite_code, phone`,
      [vendor.id, code, phone]
    );

    // Perfil opcional: nombre para mostrarlo mientras no se vincule.
    // (el profile real se crea cuando el repartidor elige contraseña)
    return NextResponse.json({ ok: true, staff: { id: row?.id, invite_code: row?.invite_code, phone: row?.phone, status: "pending" }, name });
  }

  if (action === "regenerate") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
    const code = generateLinkCode();
    await query(
      `UPDATE vendor_staff SET invite_code = $1, status = 'pending' WHERE id = $2 AND vendor_id = $3`,
      [code, id, vendor.id]
    );
    return NextResponse.json({ ok: true, id, inviteCode: code });
  }

  return NextResponse.json({ error: "Acción desconocida" }, { status: 400 });
}

// DELETE ?id= → revoca al repartidor (pierde acceso).
export async function DELETE(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const url = new URL(request.url);
  const staffId = url.searchParams.get("id") ?? "";
  if (!staffId) return NextResponse.json({ error: "Falta id" }, { status: 400 });

  await query(`UPDATE vendor_staff SET status = 'revoked', invite_code = NULL WHERE id = $1 AND vendor_id = $2`, [staffId, vendor.id]);
  return NextResponse.json({ ok: true });
}