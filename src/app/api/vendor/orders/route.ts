import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json(
      { error: "No tenés un local registrado" },
      { status: 403 }
    );
  }

  const orders = await queryMany<Record<string, unknown>>(
    `SELECT * FROM orders WHERE vendor_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [vendor.id]
  );

  return NextResponse.json({ orders });
}