import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, query, hasTable } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HYBRID = new Set(["servicio", "estetica", "taller"]);

/** Campos editables de la ficha (todos opcionales en el body). */
const TEXT_FIELDS = ["brand", "model", "identifier", "rodado", "color", "notes"] as const;
const KINDS = new Set(["bici", "moto", "automotor", "electro", "otro"]);
const MAX: Record<string, number> = {
  brand: 80,
  model: 80,
  identifier: 80,
  rodado: 40,
  color: 40,
  notes: 500,
};

/**
 * PATCH /api/vendor/equipment/[id] — edita una ficha de equipo.
 * Body: { photo_url?, brand?, model?, identifier?, rodado?, color?, notes?, kind? }
 * `photo_url` solo acepta URLs de uploads propios (/uploads/...).
 * Tolerante a migraciones sin aplicar: cada campo se guarda si la columna existe.
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

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM equipment WHERE vendor_id = $1 AND id = $2 LIMIT 1`,
    [gate.vendor.id, id]
  ).catch(() => undefined);
  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  // Foto de recepción (migrate-taller-v2).
  const hasPhoto = await queryOne<{ e: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'photo_url'
     ) AS e`
  ).catch(() => ({ e: false }));

  const sets: string[] = [];
  const values: unknown[] = [];
  if (body?.photo_url !== undefined) {
    if (hasPhoto?.e) {
      const raw = typeof body.photo_url === "string" ? body.photo_url.trim().slice(0, 500) : "";
      const photoUrl = raw && (raw.startsWith("/uploads/") || raw.includes("/uploads/")) ? raw : null;
      sets.push(`photo_url = $${values.length + 1}`);
      values.push(photoUrl);
    }
  }

  // Texto de la ficha: solo si la columna existe.
  for (const field of TEXT_FIELDS) {
    if (body?.[field] === undefined) continue;
    const has = await queryOne<{ e: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = $1
       ) AS e`,
      [field]
    ).catch(() => ({ e: false }));
    if (!has?.e) continue;
    const raw = String(body[field] ?? "").trim().slice(0, MAX[field] || 120);
    sets.push(`${field} = $${values.length + 1}`);
    values.push(raw || null);
  }

  // Tipo de equipo (opcional).
  if (typeof body?.kind === "string" && KINDS.has(body.kind)) {
    const has = await queryOne<{ e: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'equipment' AND column_name = 'kind'
       ) AS e`
    ).catch(() => ({ e: false }));
    if (has?.e) {
      sets.push(`kind = $${values.length + 1}`);
      values.push(body.kind);
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ ok: true, equipment: null });
  }

  const row = await queryOne<Record<string, unknown>>(
    `UPDATE equipment SET ${sets.join(", ")}, updated_at = now()
      WHERE vendor_id = $${values.length + 1} AND id = $${values.length + 2}
      RETURNING id::text AS id, brand, model, identifier, rodado, color, notes, photo_url`,
    [...values, gate.vendor.id, id]
  ).catch(() => undefined);
  return NextResponse.json({ ok: true, equipment: row });
}
