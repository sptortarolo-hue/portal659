import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";

// Resuelve un código de invitación → comercio + teléfono pre-cargado.
// Sirve para que /vincular?code=XXX muestre "Sos repartidor de X · teléfono".
// No revela si ya fue usado; solo si el código existe y está pendiente.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "Falta el código" }, { status: 400 });

  const invite = await queryOne<{ phone: string | null; status: string; vendor_id: string }>(
    `SELECT phone, status, vendor_id FROM vendor_staff WHERE invite_code = $1 LIMIT 1`,
    [code]
  );

  if (!invite) return NextResponse.json({ error: "Código inválido o vencido" }, { status: 404 });

  if (invite.status === "revoked") {
    return NextResponse.json({ error: "Este código ya no está activo" }, { status: 403 });
  }

  const vendor = await queryOne<{ store_name: string }>(
    `SELECT store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [invite.vendor_id]
  );

  return NextResponse.json({
    ok: true,
    storeName: vendor?.store_name,
    phone: invite.phone,
    used: invite.status === "active",
  });
}