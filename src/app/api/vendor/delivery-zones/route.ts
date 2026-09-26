import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Máximo de zonas de reparto por comercio. */
export const MAX_DELIVERY_ZONES = 3;

async function tableReady(): Promise<boolean> {
  try {
    const row = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_zones'
       ) AS exists`
    );
    return row?.exists === true;
  } catch {
    return false;
  }
}

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s ? s : null;
}

/** Lista las zonas de reparto del comercio. */
export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ zones: [] });
  if (!(await tableReady())) return NextResponse.json({ zones: [] });

  const zones = await queryMany<Record<string, unknown>>(
    `SELECT id, name, description, fee, position, active, created_at
     FROM delivery_zones WHERE vendor_id = $1 ORDER BY position ASC, created_at ASC`,
    [vendor.id]
  );
  return NextResponse.json({ zones: zones || [] });
}

/** Crea una zona (tope: MAX_DELIVERY_ZONES por comercio, contando todas). */
export async function POST(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  if (!(await tableReady())) {
    return NextResponse.json({ error: "Falta aplicar la migración de zonas de envío" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const name = cleanStr(body?.name, 60);
  if (!name) return NextResponse.json({ error: "La zona necesita un nombre" }, { status: 400 });
  const fee = Number(body?.fee);
  if (!Number.isFinite(fee) || fee < 0 || fee > 999999) {
    return NextResponse.json({ error: "Precio de envío inválido" }, { status: 400 });
  }

  const count = await queryOne<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM delivery_zones WHERE vendor_id = $1`,
    [vendor.id]
  );
  if ((count?.c ?? 0) >= MAX_DELIVERY_ZONES) {
    return NextResponse.json(
      { error: `Máximo ${MAX_DELIVERY_ZONES} zonas por comercio` },
      { status: 400 }
    );
  }

  const pos = await queryOne<{ m: number | null }>(
    `SELECT MAX(position) AS m FROM delivery_zones WHERE vendor_id = $1`,
    [vendor.id]
  );
  const created = await queryOne<Record<string, unknown>>(
    `INSERT INTO delivery_zones (vendor_id, name, description, fee, position)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, name, description, fee, position, active, created_at`,
    [vendor.id, name, cleanStr(body?.description, 80), Math.round(fee * 100) / 100, (pos?.m ?? -1) + 1]
  );
  return NextResponse.json({ zone: created });
}
