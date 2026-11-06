import { hasTable, hasColumn, type Tx } from "@/lib/db";
import { toE164 } from "@/lib/phone";

export type EquipmentInput = {
  kind?: string | null;
  brand?: string | null;
  model?: string | null;
  identifier?: string | null;
  rodado?: string | null;
  color?: string | null;
  notes?: string | null;
};

const clean = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").trim().slice(0, max);
  return s || null;
};

/**
 * Crea o reutiliza equipo del taller del comercio. Dedupe por serie única
 * parcial (mismo vendor + teléfono + n° equipo): si ya existe, se reusa y se
 * actualiza marca/modelo/rodado/color (lo que venga) — nunca duplica en cada
 * reserva. Tolerante: sin tabla `equipment` devuelve undefined y el llamador
 * sigue sin equipo (el resto del flujo no se toca).
 */
export async function upsertEquipmentTx(
  tx: Tx,
  vendorId: string,
  input: EquipmentInput & { customer_name?: string | null; customer_phone?: string | null }
): Promise<string | undefined> {
  if (!(await hasTable(tx, "equipment"))) return undefined;
  const kind = ["bici", "moto", "automotor", "electro", "otro"].includes(String(input.kind)) ? String(input.kind) : "bici";
  const brand = clean(input.brand, 80);
  const model = clean(input.model, 80);
  const identifier = clean(input.identifier, 80);
  const rodado = clean(input.rodado, 20);
  const color = clean(input.color, 40);
  const notes = clean(input.notes, 500);
  if (!brand && !model && !identifier && !rodado && !color) return undefined;
  const customerName = clean(input.customer_name, 120);
  const phoneNorm = toE164(input.customer_phone || "") || clean(input.customer_phone, 40);

  if (identifier) {
    const rows = await tx.query<{ id: string }>(
      `INSERT INTO equipment (vendor_id, kind, brand, model, identifier, rodado, color, notes, customer_name, customer_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (vendor_id, customer_phone, identifier) WHERE identifier IS NOT NULL AND identifier <> ''
       DO UPDATE SET brand = COALESCE(EXCLUDED.brand, equipment.brand),
                     model = COALESCE(EXCLUDED.model, equipment.model),
                     rodado = COALESCE(EXCLUDED.rodado, equipment.rodado),
                     color = COALESCE(EXCLUDED.color, equipment.color),
                     updated_at = now()
       RETURNING id`,
      [vendorId, kind, brand, model, identifier, rodado, color, notes, customerName, phoneNorm]
    );
    return rows[0]?.id ? String(rows[0].id) : undefined;
  }
  const rows = await tx.query<{ id: string }>(
    `INSERT INTO equipment (vendor_id, kind, brand, model, identifier, rodado, color, notes, customer_name, customer_phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [vendorId, kind, brand, model, null, rodado, color, notes, customerName, phoneNorm]
  );
  return rows[0]?.id ? String(rows[0].id) : undefined;
}

/** Valida que un equipment_id sea de este vendor (evita enlazar el de otro comercio). */
export async function assertEquipmentOwnerTx(
  tx: Tx,
  vendorId: string,
  equipmentId: unknown
): Promise<string | null> {
  const id = String(equipmentId || "").trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (!(await hasTable(tx, "equipment"))) return null;
  const rows = await tx.query<{ ok: boolean }>(
    `SELECT true AS ok FROM equipment WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, vendorId]
  );
  return rows[0]?.ok === true ? id : null;
}

/**
 * Resuelve el equipo para un trabajo manual (quote/booking): prioriza el
 * `equipment_id` enviado (validando dueño); si no viene, crea/reutiliza el
 * inline `{brand, model, identifier, rodado, color, notes}` del body.
 * Devuelve undefined cuando no hay migración o no hay datos suficientes.
 */
export async function resolveEquipmentForWorkTx(
  tx: Tx,
  vendorId: string,
  body: Record<string, unknown>,
  customer: { name?: string | null; phone?: string | null }
): Promise<string | undefined> {
  const fromBodyId = await assertEquipmentOwnerTx(tx, vendorId, body?.equipment_id);
  if (fromBodyId) return fromBodyId;
  const inline = body?.equipment && typeof body.equipment === "object" ? (body.equipment as Record<string, unknown>) : null;
  if (!inline) return undefined;
  return upsertEquipmentTx(tx, vendorId, {
    kind: inline.kind as string | undefined,
    brand: inline.brand as string | undefined,
    model: inline.model as string | undefined,
    identifier: inline.identifier as string | undefined,
    rodado: inline.rodado as string | undefined,
    color: inline.color as string | undefined,
    notes: inline.notes as string | undefined,
    customer_name: customer.name ?? null,
    customer_phone: customer.phone ?? null,
  });
}

/** ¿Existe la columna equipment_id en la tabla dada? (tolerante a migración sin aplicar). */
export async function hasEquipmentColumnTx(tx: Tx, table: "quotes" | "bookings"): Promise<boolean> {
  return hasColumn(tx, table, "equipment_id");
}
