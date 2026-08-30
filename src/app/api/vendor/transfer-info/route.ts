import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const data = await queryOne<Record<string, unknown>>(
    `SELECT transfer_cbu, transfer_alias, transfer_holder, transfer_qr_url, whatsapp, store_name, vertical
     FROM vendors WHERE id = $1 LIMIT 1`,
    [id]
  );

  return NextResponse.json({ vendor: data || null });
}