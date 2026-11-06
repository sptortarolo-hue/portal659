import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction, hasTable } from "@/lib/db";
import { phoneVariants } from "@/lib/equipment";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HYBRID = new Set(["servicio", "estetica", "taller"]);

/**
 * Equipos del comercio (ficha por equipo: bici, moto, electro...).
 * - GET  ?phone=... → lista del cliente, con historial (trabajos + fecha).
 *        ?id=...   → uno solo (uso del panel en modo edición).
 *        Sin params → lista completa (tope 200) — no se usa hoy, está acá
 *        para el picker inline si algún día hace falta.
 * - POST {customer_phone, customer_name?, kind?, brand?, model?, identifier?,
 *         rodado?, color?, notes?} → crea o reutiliza (dedupe por serie única).
 * Si la migración `migrate-equipment.sql` no está aplicada: GET → { equipment: [],
 * migrationMissing: true }, POST → 503 nombrando el archivo (igual que el resto).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  const vertical = (gate.vendor as { vertical?: string }).vertical || "";
  if (!HYBRID.has(vertical)) {
    return NextResponse.json({ equipment: [], verticalOk: false });
  }

  const { searchParams } = new URL(request.url);
  const idParam = (searchParams.get("id") || "").trim();
  const phoneParam = (searchParams.get("phone") || "").trim();

  const present = await hasTable(
    { query: (sql: string, params?: unknown[]) => queryMany(sql, params) },
    "equipment"
  );
  if (!present) {
    return NextResponse.json({ equipment: [], migrationMissing: true });
  }

  const cols = `id::text AS id, vendor_id, kind, brand, model, identifier, rodado, color, notes,
                customer_name, customer_phone, created_at, updated_at`;
  const jobs = `COALESCE((SELECT COUNT(*)::int FROM bookings b WHERE b.equipment_id = e.id), 0) +
                COALESCE((SELECT COUNT(*)::int FROM quotes q WHERE q.equipment_id = e.id), 0) AS jobs,
                GREATEST((SELECT MAX(b.created_at) FROM bookings b WHERE b.equipment_id = e.id),
                         (SELECT MAX(q.created_at) FROM quotes q WHERE q.equipment_id = e.id)) AS last_job_at`;

  if (idParam && /^[0-9a-f-]{36}$/i.test(idParam)) {
    const row = await queryOne<Record<string, unknown>>(
      `SELECT ${cols}, ${jobs} FROM equipment e WHERE e.vendor_id = $1 AND e.id = $2 LIMIT 1`,
      [gate.vendor.id, idParam]
    ).catch(() => undefined);
    return NextResponse.json({ equipment: row ? [row] : [] });
  }

  if (phoneParam) {
    const variants = phoneVariants(phoneParam);
    if (variants.length === 0) return NextResponse.json({ equipment: [] });
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT ${cols}, ${jobs} FROM equipment e
       WHERE e.vendor_id = $1 AND e.customer_phone = ANY($2)
       ORDER BY last_job_at DESC NULLS LAST, e.created_at DESC
       LIMIT 100`,
      [gate.vendor.id, variants]
    ).catch(() => []);
    return NextResponse.json({ equipment: rows || [] });
  }

  const rows = await queryMany<Record<string, unknown>>(
    `SELECT ${cols}, ${jobs} FROM equipment e
     WHERE e.vendor_id = $1 ORDER BY e.created_at DESC LIMIT 200`,
    [gate.vendor.id]
  ).catch(() => []);
  return NextResponse.json({ equipment: rows || [] });
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  const vertical = (gate.vendor as { vertical?: string }).vertical || "";
  if (!HYBRID.has(vertical)) {
    return NextResponse.json({ error: "Solo disponible para talleres, servicios y estética" }, { status: 403 });
  }

  const present = await hasTable(
    { query: (sql: string, params?: unknown[]) => queryMany(sql, params) },
    "equipment"
  );
  if (!present) {
    return NextResponse.json({ error: "Falta aplicar la migración migrate-equipment.sql en la base" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const phoneNorm = toE164(String(body.customer_phone || "")) || String(body.customer_phone || "").trim();
  const customerName = String(body.customer_name || "").trim().slice(0, 120) || null;
  const kind = ["bici", "moto", "automotor", "electro", "otro"].includes(String(body.kind)) ? String(body.kind) : "bici";
  const brand = String(body.brand || "").trim().slice(0, 80) || null;
  const model = String(body.model || "").trim().slice(0, 80) || null;
  const identifier = String(body.identifier || "").trim().slice(0, 80) || null;
  const rodado = String(body.rodado || "").trim().slice(0, 20) || null;
  const color = String(body.color || "").trim().slice(0, 40) || null;
  const notes = String(body.notes || "").trim().slice(0, 500) || null;
  if (!brand && !model && !identifier && !rodado && !color) {
    return NextResponse.json({ error: "Cargá al menos marca/modelo o N° de serie" }, { status: 400 });
  }

  const row = await withTransaction(async (tx) => {
    // Con serie: reusa el existente (el índice único parcial lo garantiza).
    if (identifier) {
      const existing = await tx.queryOne<Record<string, unknown>>(
        `INSERT INTO equipment (vendor_id, kind, brand, model, identifier, rodado, color, notes, customer_name, customer_phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (vendor_id, customer_phone, identifier) WHERE identifier IS NOT NULL AND identifier <> ''
         DO UPDATE SET brand = COALESCE(EXCLUDED.brand, equipment.brand),
                       model = COALESCE(EXCLUDED.model, equipment.model),
                       rodado = COALESCE(EXCLUDED.rodado, equipment.rodado),
                       color = COALESCE(EXCLUDED.color, equipment.color),
                       notes = COALESCE(equipment.notes, EXCLUDED.notes),
                       updated_at = now()
         RETURNING id::text AS id, vendor_id, kind, brand, model, identifier, rodado, color, notes,
                   customer_name, customer_phone, created_at, updated_at`,
        [gate.vendor.id, kind, brand, model, identifier, rodado, color, notes, customerName, phoneNorm || null]
      );
      return existing;
    }
    const created = await tx.queryOne<Record<string, unknown>>(
      `INSERT INTO equipment (vendor_id, kind, brand, model, identifier, rodado, color, notes, customer_name, customer_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id::text AS id, vendor_id, kind, brand, model, identifier, rodado, color, notes,
                 customer_name, customer_phone, created_at, updated_at`,
      [gate.vendor.id, kind, brand, model, null, rodado, color, notes, customerName, phoneNorm || null]
    );
    return created;
  });

  return NextResponse.json({ ok: true, equipment: row });
}
