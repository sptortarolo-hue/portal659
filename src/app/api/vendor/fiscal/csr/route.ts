import { queryMany, queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { resolveVendorPlan } from "@/lib/plans";
import { encryptFiscalSecret } from "@/lib/arca/crypto";
import { generateKeyAndCsr } from "@/lib/arca/csr";
import type { Plan, Vendor } from "@/types/database";
import { NextResponse } from "next/server";

/**
 * Genera clave privada + CSR para el certificado ARCA del comercio.
 * Requiere CUIT cargado. La clave se guarda CIFRADA (nunca se devuelve);
 * el CSR se muestra para pegarlo en WSASS / Adm. de Certificados.
 * Regenerar invalida el CSR anterior (la clave vieja se reemplaza).
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
  if (!/^\d{11}$/.test(cuit)) {
    return NextResponse.json(
      { error: "Cargá primero un CUIT válido para generar el CSR", code: "fiscal_config" },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => ({}));
  let keyPem: string;
  let csrPem: string;
  try {
    ({ keyPem, csrPem } = generateKeyAndCsr({
      cuit,
      org: vendor.store_name || "Mi Comercio",
      system: typeof body.system === "string" && body.system.trim() ? body.system : "Portal659",
    }));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo generar el CSR" },
      { status: 400 }
    );
  }

  try {
    await queryOne(`UPDATE vendors SET fiscal_key = $2 WHERE id = $1 RETURNING id`, [
      gateVendor.id,
      encryptFiscalSecret(keyPem),
    ]);
  } catch {
    return NextResponse.json(
      { error: "No se pudo guardar la clave (¿aplicaste migrate-fiscal.sql?)" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, csr_pem: csrPem });
}
