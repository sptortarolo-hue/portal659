import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Portal 659 Envíos: opt-in del comercio a zonas extendidas del catálogo.
 * GET lista el catálogo con el estado del comercio (active + override).
 * POST activa/desactiva (upsert) y setea el override de precio (con tope:
 * nunca menos que el precio del catálogo, que es el costo real del portal).
 */

async function catalogReady(): Promise<boolean> {
  try {
    const row = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = 'shipping_zones'
       ) AS exists`
    );
    return row?.exists === true;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  if (!(await catalogReady())) return NextResponse.json({ zones: [] });

  const rows = await queryMany<Record<string, unknown>>(
    `SELECT sz.id, sz.name, sz.description, sz.price, sz.eta_days,
            c.name AS carrier_name,
            vsz.active AS vendor_active, vsz.fee_override
     FROM shipping_zones sz
     LEFT JOIN carriers c ON c.id = sz.carrier_id
     LEFT JOIN vendor_ship_zones vsz
       ON vsz.shipping_zone_id = sz.id AND vsz.vendor_id = $1
     WHERE sz.active = true
     ORDER BY sz.position ASC, sz.created_at ASC`,
    [vendor.id]
  );
  const zones = (rows || []).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    description: r.description != null ? String(r.description) : null,
    price: Number(r.price) || 0,
    etaDays: Number(r.eta_days) || 0,
    carrierName: r.carrier_name != null ? String(r.carrier_name) : null,
    vendorActive: r.vendor_active === true,
    feeOverride: r.fee_override != null ? Number(r.fee_override) : null,
  }));
  return NextResponse.json({ zones });
}

export async function POST(request: Request) {
  const { vendor, staffRole } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  if (staffRole === "delivery") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (!(await catalogReady())) {
    return NextResponse.json(
      { error: "Falta aplicar la migración de envíos (migrate-portal-shipments.sql)" },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const zoneId = String(body?.zoneId ?? "").trim();
  if (!zoneId) return NextResponse.json({ error: "Falta la zona" }, { status: 400 });

  const zone = await queryOne<{ id: string; price: number }>(
    `SELECT id, price FROM shipping_zones WHERE id = $1 AND active = true LIMIT 1`,
    [zoneId]
  );
  if (!zone) return NextResponse.json({ error: "Zona no encontrada" }, { status: 404 });

  const feeOverrideRaw = Number(body?.feeOverride);
  const feeValid = Number.isFinite(feeOverrideRaw) && feeOverrideRaw > 0;
  // El override solo puede sumar (precio real logística = piso).
  const feeOverride = feeValid && feeOverrideRaw >= Number(zone.price)
    ? Math.round(feeOverrideRaw * 100) / 100
    : null;

  // Upsert del opt-in (UNIQUE vendor+zone).
  const upserted = await queryOne<Record<string, unknown>>(
    `INSERT INTO vendor_ship_zones (vendor_id, shipping_zone_id, fee_override, active)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (vendor_id, shipping_zone_id)
     DO UPDATE SET fee_override = $3, active = $4
     RETURNING id, vendor_id, shipping_zone_id, fee_override, active`,
    [vendor.id, zoneId, feeOverride, body?.active !== false]
  );
  if (!upserted) {
    return NextResponse.json({ error: "No se pudo actualizar la zona" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, zoneOpt: upserted });
}
