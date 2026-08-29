import { query, queryOne } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { generatePrintToken } from "@/lib/print-token";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const vendor = await queryOne<{ id: string }>(
    `SELECT id FROM vendors WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );

  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const token = generatePrintToken();
  await query(
    `UPDATE vendors SET print_token = $1, print_mode = 'app' WHERE id = $2`,
    [token, vendor.id]
  );

  return NextResponse.json({ ok: true, token });
}