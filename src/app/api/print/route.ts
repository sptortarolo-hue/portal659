import { query, queryOne, queryMany } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { NextResponse } from "next/server";
import { dispatchPrint, type CashClosingPrintData, type FiscalPrintInfo, type PrinterVendor } from "@/lib/thermal-printer";
import { resolveVendorPlan } from "@/lib/plans";
import type { Order, Plan, Vendor } from "@/types/database";

export async function POST(request: Request) {
  const { vendor: gateVendor, staffRole } = await getVendorByRequest(request);
  if (!gateVendor) {
    return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
  }
  // Repartidores no imprimen (mismo alcance que antes: dueño/admin/preview).
  if (staffRole === "delivery") {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const { orderId, test, type, tableName, subLabel, items, total } = body;
  // Info de efectivo para precuenta (viene del panel, es solo informativa).
  const cashPct = Number(body.cashPct) || 0;
  const cashTotal = Number(body.cashTotal) || 0;

  const vendor = await queryOne<PrinterVendor & Vendor>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [gateVendor.id]
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

  // Cierre de caja (Z): imprime el cierre guardado tal cual quedó en la DB.
  if (type === "cash_close") {
    const closingId = body.closingId;
    if (!closingId) {
      return NextResponse.json({ ok: false, error: "closingId requerido" }, { status: 400 });
    }
    const closing = await queryOne<CashClosingPrintData>(
      `SELECT closed_at, since, orders_count, gross_total, discounts_total, net_total,
              by_method, cash_declared, cash_difference, notes
       FROM cash_closings WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [closingId, vendor.id]
    );
    if (!closing) {
      return NextResponse.json({ ok: false, error: "Cierre no encontrado" }, { status: 404 });
    }
    const result = await dispatchPrint({ vendor, type: "cash_close", extra: { closing } });
    await recordLastPrint(vendor.id, result);
    return printResponse(result);
  }

  // Precuenta de mesa: no es un pedido; solo ítems + total + nombre de mesa.
  if (type === "precuenta") {
    if (!Array.isArray(items) || items.length === 0 || !total) {
      return NextResponse.json({ ok: false, error: "items y total requeridos" }, { status: 400 });
    }
    const result = await dispatchPrint({
      vendor,
      type: "precuenta",
      extra: { tableName, items, total: Number(total), cashPct, cashTotal },
    });
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

  const resolvedType = type === "ticket" ? "ticket" : type === "retiro" ? "retiro" : type === "despacho" ? "despacho" : "comanda";
  // Retail (moda/comercio): el ticket sale como COMPROBANTE con Nro. diario
  // y datos del cliente; gastronomía mantiene TICKET.
  const isRetailVendor = vendor.vertical === "moda" || vendor.vertical === "comercio";
  // Bloque fiscal: si el pedido tiene comprobante ARCA, el ticket lo imprime
  // con CAE + QR (tolerante a migración fiscal sin aplicar).
  let fiscal: FiscalPrintInfo | null = null;
  if (resolvedType === "ticket") {
    try {
      const inv = await queryOne<{
        punto_venta: number;
        cbte_nro: number;
        cae: string;
        cae_vto: string;
        total: number;
        created_at: string;
      }>(
        `SELECT punto_venta, cbte_nro, cae,
                CASE WHEN pg_typeof(cae_vto) = 'date'::regtype THEN to_char(cae_vto, 'YYYYMMDD') ELSE cae_vto::text END AS cae_vto,
                total, created_at
         FROM invoices WHERE vendor_id = $1 AND order_id = $2 LIMIT 1`,
        [vendor.id, orderId]
      );
      if (inv && vendor.cuit) {
        const { buildQrUrl } = await import("@/lib/arca/qr");
        fiscal = {
          cuit: vendor.cuit,
          puntoVenta: Number(inv.punto_venta),
          cbteNro: Number(inv.cbte_nro),
          cae: String(inv.cae),
          caeVto: String(inv.cae_vto).replace(/\D/g, ""),
          fechaEmision: inv.created_at ? new Date(inv.created_at).toISOString() : null,
          condIva: vendor.fiscal_cond_iva ?? null,
          qrUrl: buildQrUrl({
            cuit: vendor.cuit,
            ptoVta: Number(inv.punto_venta),
            cbteTipo: 11,
            cbteNro: Number(inv.cbte_nro),
            importe: Number(inv.total),
            cae: String(inv.cae),
            fecha: new Date(),
          }),
        };
      }
    } catch {
      fiscal = null;
    }
  }
  const result = await dispatchPrint({
    vendor,
    order,
    type: resolvedType,
    extra: {
      tableName,
      subLabel,
      ...(resolvedType === "ticket" && isRetailVendor
        ? { docTitle: "COMPROBANTE", retail: true }
        : {}),
      ...(fiscal ? { fiscal } : {}),
    },
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