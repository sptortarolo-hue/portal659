import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { decryptFiscalSecret, encryptFiscalSecret, isValidCuit } from "@/lib/arca/crypto";
import { validateCertKeyPair } from "@/lib/arca/wsaa";
import type { Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

type FiscalRow = Pick<
  Vendor,
  | "cuit"
  | "fiscal_cond_iva"
  | "fiscal_punto_venta"
  | "fiscal_env"
  | "fiscal_cert"
  | "fiscal_key"
>;

/** Config fiscal del comercio (los secretos NUNCA salen de acá). */
export async function GET(request: Request) {
  const { vendor: gateVendor } = await getVendorByRequest(request);
  if (!gateVendor) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const vendor = await queryOne<Vendor & FiscalRow>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [gateVendor.id]
  );
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const plans = await queryMany<Plan>(`SELECT * FROM plans`);
  const plan = resolveVendorPlan(vendor, plans || []);
  const hasCert = !!(vendor.fiscal_cert && vendor.fiscal_key);
  let certInfo: { subject: string; notAfter: string } | null = null;
  if (hasCert) {
    try {
      const cert = decryptFiscalSecret(vendor.fiscal_cert as string);
      const key = decryptFiscalSecret(vendor.fiscal_key as string);
      certInfo = validateCertKeyPair(cert, key);
    } catch {
      certInfo = null;
    }
  }
  const ready =
    plan.can("fiscal") &&
    !!vendor.cuit &&
    isValidCuit(vendor.cuit) &&
    !!vendor.fiscal_punto_venta &&
    hasCert &&
    certInfo !== null;

  return NextResponse.json({
    can_fiscal: plan.can("fiscal"),
    cuit: vendor.cuit || null,
    fiscal_cond_iva: vendor.fiscal_cond_iva || "monotributo",
    fiscal_punto_venta: vendor.fiscal_punto_venta ?? null,
    fiscal_env: vendor.fiscal_env || "homo",
    has_cert: hasCert,
    cert_info: certInfo,
    ready,
  });
}

/** Guarda CUIT / punto de venta / entorno / certificado+clave (cifrados). */
export async function PATCH(request: Request) {
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
  const updates: Record<string, unknown> = {};

  if (body.cuit !== undefined) {
    const cuit = String(body.cuit || "").replace(/\D/g, "");
    if (cuit && !isValidCuit(cuit)) {
      return NextResponse.json({ error: "CUIT inválido (11 dígitos con verificador)" }, { status: 400 });
    }
    updates.cuit = cuit || null;
  }
  if (body.fiscal_punto_venta !== undefined) {
    const pv = Number(body.fiscal_punto_venta);
    if (body.fiscal_punto_venta !== null && (!Number.isInteger(pv) || pv <= 0 || pv > 99999)) {
      return NextResponse.json({ error: "Punto de venta inválido" }, { status: 400 });
    }
    updates.fiscal_punto_venta = Number.isInteger(pv) && pv > 0 ? pv : null;
  }
  if (body.fiscal_env !== undefined) {
    if (!["homo", "prod"].includes(body.fiscal_env)) {
      return NextResponse.json({ error: "Entorno inválido (homo|prod)" }, { status: 400 });
    }
    updates.fiscal_env = body.fiscal_env;
  }
  // Borra certificado + clave (el comercio queda sin fiscal hasta subir otro).
  if (body.clear_fiscal_creds === true) {
    updates.fiscal_cert = null;
    updates.fiscal_key = null;
  }

  // Certificado (+ clave): se validan (parseo + vigencia) y se guardan
  // cifrados. Si la clave se generó en el portal (botón CSR), alcanza con
  // subir solo el .crt: se valida contra la clave guardada.
  if (body.cert_pem !== undefined || body.key_pem !== undefined) {
    const certPem = String(body.cert_pem || "").trim();
    let keyPem = String(body.key_pem || "").trim();
    if (!certPem) {
      return NextResponse.json({ error: "Subí el certificado (.crt)" }, { status: 400 });
    }
    if (!keyPem) {
      const stored = vendor.fiscal_key;
      if (!stored) {
        return NextResponse.json(
          { error: "Generá primero la clave con el botón CSR, o subí .crt + .key juntos" },
          { status: 400 }
        );
      }
      try {
        keyPem = decryptFiscalSecret(stored);
      } catch {
        return NextResponse.json(
          { error: "No se pudo leer la clave guardada (regenerá el CSR)" },
          { status: 500 }
        );
      }
    }
    try {
      validateCertKeyPair(certPem, keyPem);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Certificado inválido" },
        { status: 400 }
      );
    }
    updates.fiscal_cert = encryptFiscalSecret(certPem);
    // Solo se pisa la clave si se subió una nueva (la del portal sigue si no).
    if (body.key_pem !== undefined && String(body.key_pem || "").trim()) {
      updates.fiscal_key = encryptFiscalSecret(keyPem);
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  const set = Object.keys(updates)
    .map((k, i) => `${k} = $${i + 2}`)
    .join(", ");
  await queryOne(`UPDATE vendors SET ${set} WHERE id = $1 RETURNING id`, [
    gateVendor.id,
    ...Object.values(updates),
  ]);

  return NextResponse.json({ ok: true });
}
