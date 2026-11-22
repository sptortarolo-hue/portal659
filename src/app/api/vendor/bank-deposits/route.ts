import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne, queryMany } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return NextResponse.json({ error: "no_vendor" }, { status: 404 });
  }
  const vendorId = vendor.id;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

  let whereClause = "WHERE bd.vendor_id = $1";
  const params: any[] = [vendorId];

  if (status && status !== "all") {
    whereClause += " AND bd.match_confidence = $2";
    params.push(status);
  }

  const deposits = await queryMany<any>(
    `SELECT bd.*, o.id as order_id, o.total as order_total, o.customer_name as order_customer_name, o.status as order_status
     FROM bank_deposits bd
     LEFT JOIN orders o ON o.id = bd.matched_order_id
     ${whereClause}
     ORDER BY bd.received_at DESC
     LIMIT $${params.length + 1}`,
    [...params, limit]
  );

  const unmatchedCount = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int as count FROM bank_deposits WHERE vendor_id = $1 AND matched_order_id IS NULL AND match_confidence != 'ignored'",
    [vendorId]
  );

  return NextResponse.json({
    deposits,
    unmatchedCount: unmatchedCount?.count ?? 0,
  });
}