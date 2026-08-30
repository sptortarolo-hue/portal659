import { query, queryOne, queryMany } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { NextResponse } from "next/server";
import { dispatchPrint, type PrinterVendor } from "@/lib/thermal-printer";
import { resolveVendorPlan } from "@/lib/plans";
import type { Order, Plan, Vendor } from "@/types/database";

export async function POST(request: Request) {
  const { userId } = await getVendorByRequest(request);
  if (!userId) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json();
  const { orderId, test, type, tableName, subLabel } = body;

  const vendor = await queryOne<PrinterVendor & Vendor>(
    `SELECT * FROM vendors WHERE user_id = $1 LIMIT 1`,
    [userId]
  );

  if (!vendor) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendor, plans || []);
  if (!plan.can("printer")) {
    return NextResponse.json(
      { ok: false, error: "Impresión exclusiva del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  if (test) {
    const result = await dispatchPrint({ vendor, type: "test" });
    await recordLastPrint(vendor.id, result);
    return printResponse(result);
  }

  if (!orderId) {
    return NextResponse.json({ ok: false, error: "orderId requerido" }, { status: 400 });
  }

  const order = await queryOne<Order>(
    `SELECT * FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [orderId, vendor.id]
  );

  if (!order) {
    return NextResponse.json({ ok: false, error: "Pedido no encontrado" }, { status: 404 });
  }

  const result = await dispatchPrint({
    vendor,
    order,
    type: type === "ticket" ? "ticket" : type === "retiro" ? "retiro" : "comanda",
    extra: { tableName, subLabel },
  });
  await recordLastPrint(vendor.id, result);
  return printResponse(result);
}

function printResponse(result: { ok: boolean; mode: string; skipped?: boolean; offline?: boolean; error?: string }) {
  const body: Record<string, unknown> = { ok: result.ok, mode: result.mode };
  if (result.skipped) body.reason = "Impresora no configurada";
  if (result.offline) body.offline = true;
  body.error = result.error;
  return NextResponse.json(body);
}

async function recordLastPrint(
  vendorId: string,
  result: { ok: boolean; skipped?: boolean; error?: string }
) {
  if (result.skipped) return;
  await query(
    `UPDATE vendors SET last_print_at = now(), last_print_ok = $1, last_print_error = $2 WHERE id = $3`,
    [result.ok, result.ok ? null : result.error || null, vendorId]
  );
}