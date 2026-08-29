import { query } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { generatePrintToken } from "@/lib/print-token";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { vendor } = await getVendorByRequest(request);

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