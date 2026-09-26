import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { decryptFiscalSecret, isValidCuit } from "@/lib/arca/crypto";
import { ArcaError } from "@/lib/arca/wsaa";
import { explainArcaFault } from "@/lib/arca/faults";
import { emitirNotaCreditoC } from "@/lib/arca/emit";
import { CBTE_FACTURA_C, CBTE_NOTA_CREDITO_C, parseArcaObs } from "@/lib/arca/wsfe";
import type { Order, Plan, Vendor } from "@/types/database";
import type { FiscalInvoice } from "@/lib/arca/emit";
import { NextResponse } from "next/server";

/**
 * Emite la Nota de Crédito C que anula (total) la factura de un pedido.
 * Idempotente: si ya existe NC para esa factura, devuelve la existente.
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

  // Factura original a anular.
  const original = await queryOne<FiscalInvoice>(
    `SELECT * FROM invoices WHERE vendor_id = $1 AND order_id = $2 AND cbte_tipo = $3 LIMIT 1`,
    [vendor.id, orderId, CBTE_FACTURA_C]
  );
  if (!original) {
    return NextResponse.json(
      { error: "Ese pedido no tiene factura para anular", code: "no_invoice" },
      { status: 404 }
    );
  }

  // Idempotencia: una NC por factura (v1: anulación total).
  const existingNc = await queryOne<FiscalInvoice>(
    `SELECT * FROM invoices WHERE vendor_id = $1 AND cbte_tipo = $2
      AND asoc_pto = $3 AND asoc_nro = $4 LIMIT 1`,
    [vendor.id, CBTE_NOTA_CREDITO_C, original.punto_venta, original.cbte_nro]
  );
  if (existingNc) return NextResponse.json({ ok: true, invoice: existingNc, recovered: true });

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
  const total = Number(original.total);
  try {
    const r = await emitirNotaCreditoC(
      { env, cuit, certPem, keyPem },
      ptoVta,
      total,
      { tipo: CBTE_FACTURA_C, ptoVta: Number(original.punto_venta), nro: Number(original.cbte_nro) }
    );
    const saved = await queryOne<FiscalInvoice>(
      `INSERT INTO invoices (vendor_id, order_id, cbte_tipo, punto_venta, cbte_nro, cae, cae_vto, total, receptor_doc_tipo, receptor_doc_nro, env, asoc_tipo, asoc_pto, asoc_nro)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 99, '0', $9, $10, $11, $12)
       RETURNING *`,
      [vendor.id, orderId, r.cbteTipo, r.puntoVenta, r.cbteNro, r.cae, r.caeVto, total, env,
        CBTE_FACTURA_C, Number(original.punto_venta), Number(original.cbte_nro)]
    );
    return NextResponse.json({ ok: true, invoice: saved, qr_url: r.qrUrl, recovered: r.recovered });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de ARCA";
    const code = e instanceof ArcaError ? "arca_error" : "fiscal_error";
    const hint = explainArcaFault(msg);
    const obs = e instanceof ArcaError ? parseArcaObs(e.detail || "") : [];
    const fullMsg = obs.length > 0 ? `${msg} (${obs.join(" | ").slice(0, 500)})` : msg;
    return NextResponse.json({ error: fullMsg, code, ...(hint ? { hint } : {}) }, { status: 502 });
  }
}
