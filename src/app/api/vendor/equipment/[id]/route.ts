import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, query, hasTable } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HYBRID = new Set(["servicio", "estetica", "taller"]);

/**
 * PATCH /api/vendor/equipment/[id] — edita una ficha (hoy: foto de recepción).
 * Body: { photo_url } — solo URLs de uploads propios (/uploads/...).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  const vertical = (gate.vendor as { vertical?: string }).vertical || "";
  if (!HYBRID.has(vertical)) {
    return NextResponse.json({ error: "Solo disponible para talleres, servicios y estética" }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const present = await hasTable(
    { query: (sql: string, p?: unknown[]) => query(sql, p) } as any,
    "equipment"
  );
  if (!present) {
    return NextResponse.json({ error: "Falta aplicar la migración migrate-equipment.sql en la base" }, { status: 503 });
  }
  const hasPhoto = await queryOne<{ e: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'photo_url'
     ) AS e`
  ).catch(() => ({ e: false }));
  if (!hasPhoto?.e) {
    return NextResponse.json({ error: "Falta aplicar la migración migrate-taller-v2.sql en la base" }, { status: 503 });
  }

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM equipment WHERE vendor_id = $1 AND id = $2 LIMIT 1`,
    [gate.vendor.id, id]
  ).catch(() => undefined);
  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const raw = typeof body.photo_url === "string" ? body.photo_url.trim().slice(0, 500) : "";
  const photoUrl = raw && (raw.startsWith("/uploads/") || raw.includes("/uploads/")) ? raw : null;

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE equipment SET photo_url = $1, updated_at = now()
      WHERE vendor_id = $2 AND id = $3
      RETURNING id::text AS id, photo_url`,
    [photoUrl, gate.vendor.id, id]
  ).catch(() => undefined);
  return NextResponse.json({ ok: true, equipment: row });
}
