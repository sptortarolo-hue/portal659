import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function cleanStr(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s ? s : null;
}

/** Edita una zona propia (nombre, descripción, precio, activa). */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length + 1}`);
  };

  if (body?.name !== undefined) {
    const name = cleanStr(body.name, 60);
    if (!name) return NextResponse.json({ error: "La zona necesita un nombre" }, { status: 400 });
    push("name", name);
  }
  if (body?.description !== undefined) {
    push("description", cleanStr(body.description, 80));
  }
  if (body?.fee !== undefined) {
    const fee = Number(body.fee);
    if (!Number.isFinite(fee) || fee < 0 || fee > 999999) {
      return NextResponse.json({ error: "Precio de envío inválido" }, { status: 400 });
    }
    push("fee", Math.round(fee * 100) / 100);
  }
  if (body?.active !== undefined) {
    push("active", body.active === true);
  }
  if (body?.position !== undefined && Number.isInteger(Number(body.position))) {
    push("position", Number(body.position));
  }
  if (sets.length === 0) return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });

  const updated = await queryOne<Record<string, unknown>>(
    `UPDATE delivery_zones SET ${sets.join(", ")} WHERE id = $1 AND vendor_id = $2
     RETURNING id, name, description, fee, position, active, created_at`,
    [params.id, vendor.id, ...vals]
  );
  if (!updated) return NextResponse.json({ error: "Zona no encontrada" }, { status: 404 });
  return NextResponse.json({ zone: updated });
}

/**
 * Borra una zona. Los pedidos viejos conservan `delivery_zone_name`
 * denormalizado, así que el historial no se rompe.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  await query(`DELETE FROM delivery_zones WHERE id = $1 AND vendor_id = $2`, [params.id, vendor.id]);
  return NextResponse.json({ ok: true });
}
