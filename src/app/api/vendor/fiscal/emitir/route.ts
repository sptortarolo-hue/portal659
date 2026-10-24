import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { isValidCuit } from "@/lib/arca/crypto";
import { normalizeReceptorFiscal } from "@/lib/arca/wsfe";
import { issueFiscalInvoice, FiscalIssueError } from "@/lib/arca/issue-invoice";
import type { Order, Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

/**
 * Emite la Factura C de un pedido cobrado (toggle "con comprobante fiscal")
 * o de un turno atendido (cobro de servicio).
 * Idempotente por referencia (pedido o turno): si ya existe, devuelve la existente.
 * Si ARCA falla, responde 502 y el cobro sigue como "sin fiscal" (se reintenta
 * desde el historial / Facturación).
 */
export async function POST(request: Request) {
  const { vendor: gateVendor, staffRole: gateStaff } = await getVendorByRequest(request);
  if (gateStaff === "delivery" || gateStaff === "staff") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (!gateVendor) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const vendor = await queryOne<Vendor>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [gateVendor.id]
  );
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendor, plans || []);
  if (!plan.can("fiscal")) {
    return NextResponse.json(
      { error: "Facturación electrónica exclusiva del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const orderIdRaw = String(body.orderId || "");
  const bookingIdRaw = String(body.bookingId || "");
  const orderIds: string[] = Array.isArray(body.orderIds)
    ? [...new Set((body.orderIds as unknown[]).map((x) => String(x)).filter(Boolean))].slice(0, 50)
    : orderIdRaw
      ? [orderIdRaw]
      : [];
  if (orderIds.length === 0 && !bookingIdRaw) {
    return NextResponse.json({ error: "orderId o bookingId requerido" }, { status: 400 });
  }

  // Receptor: consumidor final por default; con documento (DNI/CUIT) la
  // factura sale a nombre (RG 5700/2025: CF solo se identifica desde $10M).
  let receptor;
  try {
    receptor = normalizeReceptorFiscal(
      body.receptorDocTipo,
      body.receptorDocNro,
      body.receptorCondIva,
      isValidCuit
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Receptor inválido" },
      { status: 400 }
    );
  }
  const receptorNombre =
    typeof body.receptorNombre === "string" && body.receptorNombre.trim()
      ? body.receptorNombre.trim().slice(0, 120)
      : null;

  let total = 0;
  let orderId: string | null = null;
  let bookingId: string | null = null;

  if (bookingIdRaw) {
    const b = await queryOne<{
      id: string; vendor_id: string; status: string | null;
      service_price: number | null; total?: number | null;
    }>(
      `SELECT id, vendor_id, status, service_price::numeric AS service_price FROM bookings WHERE id = $1 LIMIT 1`,
      [bookingIdRaw]
    );
    if (!b) return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
    if (b.vendor_id !== vendor.id) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    if (b.status === "cancelled") {
      return NextResponse.json({ error: "No se puede facturar un turno cancelado" }, { status: 400 });
    }
    bookingId = b.id;
    total = Math.round((Number(b.service_price) || 0) * 100) / 100;
  } else {
    const orders = await queryMany<Order>(
      `SELECT * FROM orders WHERE id = ANY($1::uuid[]) AND vendor_id = $2`,
      [orderIds, vendor.id]
    );
    if (orders.length !== orderIds.length) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }
    for (const o of orders) {
      if (o.status === "cancelled") {
        return NextResponse.json({ error: "No se puede facturar un pedido cancelado" }, { status: 400 });
      }
    }
    const principal = [...orders]
      .sort((a, b) => (String((a as any).created_at) < String((b as any).created_at) ? -1 : 1))
      .slice(-1)[0];
    orderId = principal.id;
    total = Math.round(orders.reduce((s, o) => s + (Number(o.total) || 0), 0) * 100) / 100;
  }

  if (!Number.isFinite(total) || total <= 0) {
    return NextResponse.json({ error: "Total inválido para facturar" }, { status: 400 });
  }

  // Idempotencia: una referencia = un comprobante.
  const refId = bookingId || orderId;
  const existing = await queryOne<FiscalInvoiceRow>(
    `SELECT * FROM invoices WHERE vendor_id = $1 AND COALESCE(booking_id, order_id) = $2 LIMIT 1`,
    [vendor.id, refId]
  );
  if (existing) return NextResponse.json({ ok: true, invoice: existing, recovered: true });

  let result;
  try {
    result = await issueFiscalInvoice({
      vendor,
      total,
      orderId: orderId ?? null,
      bookingId: bookingId ?? null,
      receptor,
      receptorNombre,
    });
  } catch (e) {
    if (e instanceof FiscalIssueError) {
      return NextResponse.json(
        { error: e.message, code: e.code, ...(e.hint ? { hint: e.hint } : {}), ...(e.detail ? { detail: e.detail.slice(0, 2000) } : {}) },
        { status: e.status }
      );
    }
    throw e;
  }
  return NextResponse.json({ ok: true, invoice: result.invoice, qr_url: result.qrUrl, recovered: result.recovered });
}

type FiscalInvoiceRow = {
  id: string;
  order_id: string | null;
  booking_id: string | null;
  cbte_tipo: number;
  punto_venta: number;
  cbte_nro: number;
  cae: string;
  cae_vto: string;
  total: number;
  env: string;
  created_at: string;
  receptor_doc_tipo?: number | null;
  receptor_doc_nro?: string | null;
  receptor_nombre?: string | null;
  receptor_cond_iva?: number | null;
};
