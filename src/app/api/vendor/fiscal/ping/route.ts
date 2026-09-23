import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { decryptFiscalSecret, isValidCuit } from "@/lib/arca/crypto";
import { ArcaError, getWsaaTicket } from "@/lib/arca/wsaa";
import { explainArcaFault } from "@/lib/arca/faults";
import type { Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

/**
 * Prueba la conexión con ARCA sin emitir (solo login WSAA con el
 * certificado del comercio). Diagnostica "ARCA no contesta" sin gastar
 * numeración ni tocar pedidos.
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

  const cuit = (vendor.cuit || "").replace(/\D/g, "");
  if (!cuit || !isValidCuit(cuit) || !vendor.fiscal_cert || !vendor.fiscal_key) {
    return NextResponse.json(
      { error: "Completá CUIT y certificado en la sección Fiscal", code: "fiscal_config" },
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
  const t0 = Date.now();
  try {
    await getWsaaTicket(env, cuit, certPem, keyPem);
    const ms = Date.now() - t0;
    console.log(`[fiscal] vendor=${vendor.id} env=${env} stage=ping-ok +${ms}ms`);
    return NextResponse.json({ ok: true, env, ms });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de ARCA";
    const detail = e instanceof ArcaError ? (e.detail || "").slice(0, 800) : "";
    console.log(`[fiscal] vendor=${vendor.id} env=${env} stage=ping-error +${Date.now() - t0}ms ${msg.slice(0, 200)}${detail && !msg.includes(detail.slice(0, 40)) ? ` | ${detail}` : ""}`);
    const code = e instanceof ArcaError ? "arca_error" : "fiscal_error";
    const hint = explainArcaFault(msg);
    return NextResponse.json({ error: msg, code, ...(hint ? { hint } : {}) }, { status: 502 });
  }
}
