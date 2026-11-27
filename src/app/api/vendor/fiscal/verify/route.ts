import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { decryptFiscalSecret, isValidCuit } from "@/lib/arca/crypto";
import { ArcaError } from "@/lib/arca/wsaa";
import {
  CBTE_FACTURA_C,
  puntosVentaHabilitados,
  ultimoAutorizado,
  type WsfeAuth,
} from "@/lib/arca/wsfe";
import { explainArcaFault } from "@/lib/arca/faults";
import type { Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

/**
 * Verificación end-to-end SIN gastar numeración: valida WSAA + autorización
 * WSFE + punto de venta con `FECompUltimoAutorizado` (lectura) y lista los PV
 * habilitados con `FEParamGetPtosVenta`. Nunca llama a FECAESolicitar.
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

  const cuit = (vendor.cuit || "").replace(/\D/g, "");
  const ptoVta = Number(vendor.fiscal_punto_venta);
  if (!cuit || !isValidCuit(cuit) || !Number.isInteger(ptoVta) || ptoVta <= 0 || !vendor.fiscal_cert || !vendor.fiscal_key) {
    return NextResponse.json(
      { error: "Completá CUIT, punto de venta y certificado en la sección Fiscal", code: "fiscal_config" },
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
  const auth: WsfeAuth = { env, cuit, certPem, keyPem };
  const t0 = Date.now();
  try {
    // Si esto responde, están OK el login WSAA, la autorización WSFE y el PV.
    const ultimo = await ultimoAutorizado(auth, ptoVta, CBTE_FACTURA_C);

    // Secundario: por si el PV consultado está dado de baja pero ARCA igual
    // devuelve numeración. Si falla, no invalidamos la verificación.
    const puntosVenta = await puntosVentaHabilitados(auth).catch(() => [] as number[]);
    const warnings: string[] = [];
    if (puntosVenta.length > 0 && !puntosVenta.includes(ptoVta)) {
      warnings.push(
        `El punto de venta ${ptoVta} no figura entre los habilitados (${puntosVenta.join(", ")}). Cambiá el número arriba y guardá.`
      );
    }

    const ms = Date.now() - t0;
    console.log(`[fiscal] vendor=${vendor.id} env=${env} stage=verify-ok +${ms}ms pv=${ptoVta} ultimo=${ultimo}`);
    return NextResponse.json({
      ok: true,
      env,
      ms,
      ultimo,
      proximo: ultimo + 1,
      puntosVenta,
      warnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de ARCA";
    const detail = e instanceof ArcaError ? (e.detail || "").slice(0, 800) : "";
    console.log(`[fiscal] vendor=${vendor.id} env=${env} stage=verify-error +${Date.now() - t0}ms ${msg.slice(0, 200)}${detail && !msg.includes(detail.slice(0, 40)) ? ` | ${detail}` : ""}`);
    const hint =
      /ptovta|punto de venta|10016|10006/i.test(msg + " " + detail)
        ? `El punto de venta ${ptoVta} no está habilitado. Verificá el número en ARCA o probá con otro.`
        : explainArcaFault(msg);
    return NextResponse.json(
      {
        error: msg,
        code: e instanceof ArcaError ? "arca_error" : "fiscal_error",
        ...(hint ? { hint } : {}),
      },
      { status: 502 }
    );
  }
}
