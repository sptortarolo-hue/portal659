import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { decryptFiscalSecret, isValidCuit } from "@/lib/arca/crypto";
import { ArcaError } from "@/lib/arca/wsaa";
import { emitirFacturaC } from "@/lib/arca/emit";
import type { Order, Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

export type FiscalInvoice = {
  id: string;
  order_id: string;
  cbte_tipo: number;
  punto_venta: number;
  cbte_nro: number;
  cae: string;
  cae_vto: string;
  total: number;
  env: string;
  created_at: string;
};

/**
 * Emite la Factura C de un pedido cobrado (toggle "con comprobante fiscal").
 * Idempotente por pedido: si ya existe, devuelve la existente.
 * Si ARCA falla, responde 502 y el cobro sigue como "sin fiscal" (el cliente
 * reintenta desde el historial).
 */
export async function POST(request: Request) {
  const { vendor: gateVendor } = await getVendorByRequest(request);
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
  const orderId = String(body.orderId || "");
  if (!orderId) return NextResponse.json({ error: "orderId requerido" }, { status: 400 });

  const order = await queryOne<Order>(
    `SELECT * FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [orderId, vendor.id]
  );
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  if (order.status === "cancelled") {
    return NextResponse.json({ error: "No se puede facturar un pedido cancelado" }, { status: 400 });
  }
  const total = Number(order.total);
  if (!Number.isFinite(total) || total <= 0) {
    return NextResponse.json({ error: "Total inválido para facturar" }, { status: 400 });
  }

  // Idempotencia: un pedido = un comprobante.
  const existing = await queryOne<FiscalInvoice>(
    `SELECT * FROM invoices WHERE vendor_id = $1 AND order_id = $2 LIMIT 1`,
    [vendor.id, orderId]
  );
  if (existing) return NextResponse.json({ ok: true, invoice: existing, recovered: true });

  // Config fiscal completa.
  const cuit = (vendor.cuit || "").replace(/\D/g, "");
  const ptoVta = Number(vendor.fiscal_punto_venta);
  if (!cuit || !isValidCuit(cuit) || !Number.isInteger(ptoVta) || ptoVta <= 0) {
    return NextResponse.json(
      { error: "Configurá CUIT y punto de venta en la sección Fiscal", code: "fiscal_config" },
      { status: 409 }
    );
  }
  if (!vendor.fiscal_cert || !vendor.fiscal_key) {
    return NextResponse.json(
      { error: "Subí el certificado y la clave ARCA en la sección Fiscal", code: "fiscal_config" },
      { status: 409 }
    );
  }
  let certPem: string;
  let keyPem: string;
  try {
    certPem = decryptFiscalSecret(vendor.fiscal_cert);
    keyPem = decryptFiscalSecret(vendor.fiscal_key);
  } catch {
    return NextResponse.json(
      { error: "No se pudo leer el certificado (revisá FISCAL_KEY y volvé a subirlo)", code: "fiscal_config" },
      { status: 500 }
    );
  }

  const env = vendor.fiscal_env === "prod" ? "prod" : "homo";
  try {
    const r = await emitirFacturaC(
      { env, cuit, certPem, keyPem },
      ptoVta,
      total
    );
    try {
      const saved = await queryOne<FiscalInvoice>(
        `INSERT INTO invoices (vendor_id, order_id, cbte_tipo, punto_venta, cbte_nro, cae, cae_vto, total, receptor_doc_tipo, receptor_doc_nro, env)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 99, '0', $9)
         RETURNING *`,
        [vendor.id, orderId, r.cbteTipo, r.puntoVenta, r.cbteNro, r.cae, r.caeVto, total, env]
      );
      return NextResponse.json({ ok: true, invoice: saved, qr_url: r.qrUrl, recovered: r.recovered });
    } catch {
      // Carrera: otro request lo guardó primero → devolver el existente.
      const raced = await queryOne<FiscalInvoice>(
        `SELECT * FROM invoices WHERE vendor_id = $1 AND order_id = $2 LIMIT 1`,
        [vendor.id, orderId]
      );
      if (raced) return NextResponse.json({ ok: true, invoice: raced, recovered: true });
      throw new ArcaError("No se pudo guardar el comprobante");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de ARCA";
    const code = e instanceof ArcaError ? "arca_error" : "fiscal_error";
    return NextResponse.json({ error: msg, code }, { status: 502 });
  }
}
