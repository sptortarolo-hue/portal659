import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { query, queryOne } from "@/lib/db";

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "no_vendor" }, { status: 404 });
  }
  const vendorId = parseInt(vendor.id);

  const body = await request.json();
  const { depositId, orderId } = body;

  if (!depositId || !orderId) {
    return NextResponse.json({ error: "missing_params" }, { status: 400 });
  }

  const deposit = await queryOne<any>(
    "SELECT * FROM bank_deposits WHERE id = $1 AND vendor_id = $2",
    [depositId, vendorId]
  );
  if (!deposit) {
    return NextResponse.json({ error: "deposit_not_found" }, { status: 404 });
  }

  const order = await queryOne<any>(
    "SELECT * FROM orders WHERE id = $1 AND vendor_id = $2",
    [orderId, vendorId]
  );
  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  await query(
    "UPDATE bank_deposits SET matched_order_id = $1, match_confidence = 'manual' WHERE id = $2",
    [orderId, depositId]
  );
  await query(
    "UPDATE orders SET payment_status = 'paid', paid_at = now() WHERE id = $1",
    [orderId]
  );

  return NextResponse.json({ ok: true });
}