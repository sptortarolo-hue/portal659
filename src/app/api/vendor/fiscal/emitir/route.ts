import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { decryptFiscalSecret, isValidCuit } from "@/lib/arca/crypto";
import { ArcaError } from "@/lib/arca/wsaa";
import { explainArcaFault } from "@/lib/arca/faults";
import { emitirFacturaC, type FiscalInvoice } from "@/lib/arca/emit";
import { normalizeReceptorFiscal, parseArcaObs } from "@/lib/arca/wsfe";
import type { Order, Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

/**
 * Emite la Factura C de un pedido cobrado (toggle "con comprobante fiscal").
 * Idempotente por pedido: si ya existe, devuelve la existente.
 * Si ARCA falla, responde 502 y el cobro sigue como "sin fiscal" (el cliente
 * reintenta desde el historial).
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
  const orderId = String(body.orderId || "");
  if (!orderId) return NextResponse.json({ error: "orderId requerido" }, { status: 400 });

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
  // Log por etapa (sin secretos) → visible en `docker logs` como [fiscal].
  const t0 = Date.now();
  const flog = (stage: string, extra?: string) =>
    console.log(`[fiscal] vendor=${vendor.id} order=${orderId} env=${env} stage=${stage} +${Date.now() - t0}ms${extra ? ` ${extra}` : ""}`);
  try {
    flog("start", `ptoVta=${ptoVta} total=${total}`);
    const r = await emitirFacturaC(
      { env, cuit, certPem, keyPem },
      ptoVta,
      total,
      undefined,
      receptor
    );
    flog("cae-ok", `cbte=${r.puntoVenta}-${r.cbteNro}${r.recovered ? " recovered" : ""}`);
    // Columnas receptor_nombre/cond_iva: tolerante a migración sin aplicar.
    const hasReceptorCols = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'invoices' AND column_name = 'receptor_nombre'
       ) AS exists`
    );
    const receptorCols = hasReceptorCols?.exists === true ? ", receptor_nombre, receptor_cond_iva" : "";
    const receptorVals = hasReceptorCols?.exists === true ? [receptorNombre, receptor.condicionIva] : [];
    try {
      const saved = await queryOne<FiscalInvoice>(
        `INSERT INTO invoices (vendor_id, order_id, cbte_tipo, punto_venta, cbte_nro, cae, cae_vto, total, receptor_doc_tipo, receptor_doc_nro, env${receptorCols})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11${receptorVals.map((_, i) => `, $${12 + i}`).join("")})
         RETURNING *`,
        [vendor.id, orderId, r.cbteTipo, r.puntoVenta, r.cbteNro, r.cae, r.caeVto, total, receptor.docTipo, receptor.docNro, env, ...receptorVals]
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
    // Detail largo: incluye las <Observaciones> completas del rechazo (R).
    const detail = e instanceof ArcaError ? (e.detail || "").slice(0, 4000) : "";
    flog("error", `${code}: ${msg.slice(0, 200)}${detail && !msg.includes(detail.slice(0, 40)) ? ` | ${detail}` : ""}`);
    const hint = explainArcaFault(msg);
    // Obs parseadas aparte para la UI (lista completa, no solo la primera).
    const obs = e instanceof ArcaError ? parseArcaObs(e.detail || "") : [];
    const fullMsg = obs.length > 0 ? `${msg} (${obs.join(" | ").slice(0, 500)})` : msg;
    return NextResponse.json({ error: fullMsg, code, ...(hint ? { hint } : {}) }, { status: 502 });
  }
}
