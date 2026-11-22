import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { query, queryOne } from "@/lib/db";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "no_vendor" }, { status: 404 });
  }
  const vendorId = parseInt(vendor.id);

  const { id } = await params;
  const depositId = parseInt(id);
  if (isNaN(depositId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const body = await request.json();
  const { action, orderId } = body;

  const deposit = await queryOne<any>(
    "SELECT * FROM bank_deposits WHERE id = $1 AND vendor_id = $2",
    [depositId, vendorId]
  );
  if (!deposit) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (action === "confirm") {
    const targetOrderId = orderId || deposit.matched_order_id;
    if (!targetOrderId) {
      return NextResponse.json({ error: "no_order" }, { status: 400 });
    }

    await query(
      "UPDATE bank_deposits SET matched_order_id = $1, match_confidence = 'manual' WHERE id = $2",
      [targetOrderId, depositId]
    );
    await query(
      "UPDATE orders SET payment_status = 'paid', paid_at = now() WHERE id = $1",
      [targetOrderId]
    );

    return NextResponse.json({ ok: true, action: "confirmed" });
  }

  if (action === "ignore") {
    await query(
      "UPDATE bank_deposits SET match_confidence = 'ignored' WHERE id = $1",
      [depositId]
    );
    return NextResponse.json({ ok: true, action: "ignored" });
  }

  if (action === "unmatch") {
    if (deposit.matched_order_id) {
      await query(
        "UPDATE orders SET payment_status = 'pending', paid_at = NULL WHERE id = $1",
        [deposit.matched_order_id]
      );
    }
    await query(
      "UPDATE bank_deposits SET matched_order_id = NULL, match_confidence = 'unmatched' WHERE id = $1",
      [depositId]
    );
    return NextResponse.json({ ok: true, action: "unmatched" });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}