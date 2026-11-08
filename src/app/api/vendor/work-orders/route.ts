import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { ensureServiceCustomer } from "@/lib/customers";
import { toE164 } from "@/lib/phone";
import { resolveEquipmentForWorkTx } from "@/lib/equipment-server";
import { isoTodayAR, normalizeChecklist } from "@/lib/work-order";
import { addBookingEventTx } from "@/lib/booking-events";
import { isPreviewRow } from "@/lib/preview-flag";
import { NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const HYBRID = new Set(["servicio", "estetica", "taller"]);

const iso = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/** Columnas realmente presentes en `bookings` (information_schema nunca lanza). */
async function bookingColumns(tx: unknown): Promise<Set<string>> {
  const run =
    tx && typeof (tx as { query?: unknown }).query === "function"
      ? (tx as { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> }).query
      : queryMany;
  const rows = await run<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings'`,
    []
  );
  return new Set((rows || []).map((r) => String(r.column_name)));
}

/**
 * Crea una ORDEN DE SERVICIO (recepción de taller): el cliente deja el equipo
 * hoy (fecha de ingreso) y se le estima una fecha de entrega, SIN hora ni
 * duración: no ocupa lugar en la agenda ni dispara recordatorios.
 *
 * Body: {
 *   customer_name, customer_phone, declared_issue, delivery_date?,
 *   diagnosis?, notes?, deposit_amount?, equipment_id? | equipment?: {...}
 * }
 * Nace en estado "pending" (Recibida), origin='vendor', kind='orden'.
 * Numeración CORRIDA por comercio (work_order_no = MAX + 1 del vendor).
 * Sin la migración migrate-work-orders.sql → 503 nombrando el archivo.
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!HYBRID.has((gate.vendor as { vertical?: string }).vertical || "")) {
    return NextResponse.json({ error: "Solo disponible para talleres, servicios y estética" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const customerName = String(body.customer_name || "").trim();
  const customerPhone = toE164(String(body.customer_phone || ""));
  const declaredIssue = String(body.declared_issue || "").trim().slice(0, 1000);
  const deliveryDate = body.delivery_date === "" || body.delivery_date == null ? null : iso(body.delivery_date);
  if (!customerName || !customerPhone || !declaredIssue) {
    return NextResponse.json({ error: "Faltan cliente, teléfono o la falla declarada" }, { status: 400 });
  }
  if (body.delivery_date && !deliveryDate) {
    return NextResponse.json({ error: "Fecha de entrega inválida" }, { status: 400 });
  }
  const depositAmount =
    body.deposit_amount != null && Number(body.deposit_amount) > 0 ? Math.round(Number(body.deposit_amount) * 100) / 100 : null;
  const servicePrice =
    body.service_price != null && Number(body.service_price) > 0 ? Math.round(Number(body.service_price) * 100) / 100 : null;
  // Si hay precio estimado al ingreso, la orden nace "Aprobada" (salta el
  // presupuesto). Sin precio, nace "Recibida" y se cotiza si es necesario.
  const initialStatus = servicePrice ? "approved" : "pending";

  // Migración presente: sin kind no hay órdenes (tolerante, error claro).
  const baseCols = await bookingColumns(null);
  if (!baseCols.has("kind")) {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-work-orders.sql en la base" },
      { status: 503 }
    );
  }

  const isPreview = gate.previewSession === true;
  const confirmToken = crypto.randomBytes(16).toString("hex");
  const today = isoTodayAR();

  let created: { id: string; work_order_no: number | null } | null = null;
  let depositStored: number | null = null;
  try {
    created = await withTransaction(async (tx) => {
      const cols = await bookingColumns(tx);
      // Equipo (ficha ya existente): id validado o creación al vuelo.
      const eqId = cols.has("equipment_id")
        ? await resolveEquipmentForWorkTx(tx, gate.vendor.id, body, { name: customerName, phone: customerPhone })
        : null;

      const values: Record<string, unknown> = {
        vendor_id: gate.vendor.id,
        product_id: null,
        customer_id: null,
        product_name: declaredIssue.slice(0, 120),
        customer_name: customerName,
        customer_phone: customerPhone,
        booking_date: today,
        status: initialStatus,
        origin: "vendor",
        kind: "orden",
        delivery_date: deliveryDate,
        declared_issue: declaredIssue,
        work_order_no: null,
        equipment_id: eqId ?? null,
      };
      // Columnas opcionales (migraciones que pueden faltar): se agregan solo
      // si existen, para que la orden se cree igual en bases parciales.
      if (cols.has("notes")) values.notes = String(body.notes || "").trim().slice(0, 2000) || null;
      if (cols.has("diagnosis")) values.diagnosis = String(body.diagnosis || "").trim().slice(0, 1000) || null;
      // Checklist de ingreso (taller v3): opcional y genérico.
      if (cols.has("intake_checklist") && body.intake_checklist != null) {
        const cl = normalizeChecklist(body.intake_checklist);
        const hasContent =
          (cl.accessories?.length || 0) > 0 || cl.other || cl.unlock || cl.condition;
        if (hasContent) values.intake_checklist = JSON.stringify(cl);
      }
      if (cols.has("confirm_token")) values.confirm_token = confirmToken;
      if (cols.has("is_preview")) values.is_preview = isPreview;
      if (cols.has("deposit_amount")) values.deposit_amount = depositAmount;
      if (cols.has("service_price")) values.service_price = servicePrice;

      const insertCols = Object.keys(values).filter((c) => cols.has(c));
      if (!cols.has("work_order_no")) {
        // Migración a medias: no se puede numerar → error claro.
        throw new Error("Falta aplicar la migración migrate-work-orders.sql en la base");
      }

      // Número corrido por comercio: MAX + 1, con reintento ante carrera.
      for (let attempt = 0; attempt < 3; attempt++) {
        const maxRow = await tx.queryOne<{ next: number }>(
          `SELECT COALESCE(MAX(work_order_no), 0) + 1 AS next FROM bookings WHERE vendor_id = $1 AND kind = 'orden'`,
          [gate.vendor.id]
        );
        const no = maxRow?.next ?? 1;
        values.work_order_no = no;
        const insertVals = insertCols.map((c) => values[c]);
        const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(", ");
        try {
          const rows = await tx.query<{ id: string; work_order_no: number | null }>(
            `INSERT INTO bookings (${insertCols.join(", ")}) VALUES (${placeholders})
             RETURNING id, work_order_no`,
            insertVals
          );
          if (rows[0]) {
            // Event feed: nacimiento de la orden (tolerante a migración).
            await addBookingEventTx(tx, {
              vendorId: gate.vendor.id,
              bookingId: rows[0].id,
              kind: "created",
              message: `Orden recibida${Number(rows[0].work_order_no) ? ` (N° ${rows[0].work_order_no})` : ""}: ${declaredIssue.slice(0, 120)}`,
              actor: (gate.vendor as { user_id?: string }).user_id || null,
            });
          }
          return rows[0];
        } catch (e) {
          const msg = (e as Error)?.message || "";
          if (/duplicate|unique/i.test(msg) && attempt < 2) continue;
          throw e;
        }
      }
      return null;
    });
  } catch (e) {
    const msg = (e as Error)?.message || "";
    if (msg.startsWith("Falta aplicar")) {
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    if (/equipment/i.test(msg)) {
      return NextResponse.json({ error: "Falta aplicar la migración migrate-equipment.sql en la base" }, { status: 503 });
    }
    throw e;
  }

  if (!created) {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-work-orders.sql en la base" },
      { status: 503 }
    );
  }
  if (depositAmount) depositStored = depositAmount;

  const orderRow = await queryOne<Record<string, unknown>>(
    `SELECT * FROM bookings WHERE id = $1 LIMIT 1`,
    [created.id]
  ).catch(() => undefined);

  // Cliente al libro (ficha CRM) salvo en modo prueba.
  if (!isPreview && !(await isPreviewRow("bookings", created.id))) {
    await withTransaction(async (tx) => {
      await ensureServiceCustomer(tx, gate.vendor.id, { phone: customerPhone, name: customerName });
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    booking: orderRow || { id: created.id, work_order_no: created.work_order_no },
    work_order_no: created.work_order_no,
    depositAmount: depositStored,
  });
}
