import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "El cierre de caja forma parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const closings = await queryMany<Record<string, any>>(
    `SELECT id, closed_at, since, orders_count, gross_total, discounts_total, net_total,
            by_method, cash_declared, cash_difference, notes
     FROM cash_closings
     WHERE vendor_id = $1
     ORDER BY closed_at DESC
     LIMIT 30`,
    [gate.vendor.id]
  );

  return NextResponse.json({ closings: closings || [] });
}
