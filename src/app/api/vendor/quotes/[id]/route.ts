import { gateRequest } from "@/lib/subscription-gate";
import { notifyServiceClient } from "@/lib/service-notify";
import { addServiceJob } from "@/lib/customers";
import { isPreviewRow } from "@/lib/preview-flag";
import { toE164 } from "@/lib/phone";
import { query, queryOne, withTransaction, hasColumn, hasTable } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VALID_STATUS = ["pending", "responded", "accepted", "cancelled"];

/** Responder un presupuesto: estado + notas + precio cotizado (precio = plan Oficios). */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { id } = await params;
  const existing = await queryOne<{ id: string; vendor_id: string; status: string; customer_name: string; customer_phone: string }>(
    `SELECT id, vendor_id, status, customer_name, customer_phone FROM quotes WHERE id = $1 LIMIT 1`,
    [id]
  );
  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (existing.vendor_id !== gate.vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json();
  const update: Record<string, unknown> = {};
  if (typeof body.status === "string" && VALID_STATUS.includes(body.status)) {
    update.status = body.status;
  }
  if (typeof body.vendor_notes === "string") {
    update.vendor_notes = body.vendor_notes.slice(0, 2000) || null;
  }
  // Cliente/teléfono editables (re-cotizar la orden con datos corregidos).
  if (typeof body.customer_name === "string" && body.customer_name.trim()) {
    update.customer_name = body.customer_name.trim().slice(0, 120);
  }
  if (typeof body.customer_phone === "string" && body.customer_phone.trim()) {
    update.customer_phone = toE164(body.customer_phone.trim());
  }
  // Edición de contenido (taller/oficios re-cotizando su orden): título y
  // descripción del trabajo.
  if (typeof body.description === "string") {
    update.description = body.description.trim() || "Presupuesto";
  }
  if (typeof body.service_name === "string") {
    update.service_name = body.service_name.trim() || null;
  }
  if (body.quoted_price !== undefined) {
    if (!gate.plan.can("quotes_respond")) {
      return NextResponse.json(
        { error: "Cotizar con precio requiere el plan Oficios." },
        { status: 403 }
      );
    }
    const price = body.quoted_price == null || body.quoted_price === "" ? null : Number(body.quoted_price);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return NextResponse.json({ error: "Precio inválido" }, { status: 400 });
    }
    update.quoted_price = price;
  }

  // Edición de partidas (mismo gate que el precio): reemplaza quote_items y
  // recalcula el total cotizado, igual que el POST.
  const rawItems: any[] | null = Array.isArray(body?.items) ? body.items : null;
  let items: Array<{
    kind: string; description: string; qty: number; unit_price: number;
    product_id: string | null; variant_id: string | null; position: number;
  }> | null = null;
  if (rawItems) {
    if (!gate.plan.can("quotes_respond")) {
      return NextResponse.json(
        { error: "Cotizar con precio requiere el plan Oficios." },
        { status: 403 }
      );
    }
    items = rawItems
      .map((it: any, i: number) => ({
        kind: it?.kind === "repuesto" ? "repuesto" : it?.kind === "labor" ? "labor" : "material",
        description: String(it?.description || "").trim(),
        qty: Math.max(0, Number(it?.qty) || 0),
        unit_price: Math.max(0, Number(it?.unit_price) || 0),
        product_id: typeof it?.product_id === "string" && it.product_id ? it.product_id : null,
        variant_id: typeof it?.variant_id === "string" && it.variant_id ? it.variant_id : null,
        position: i,
      }))
      .filter((it) => it.description !== "")
      .slice(0, 30);
    const itemsTotal = Math.round(items.reduce((s, it) => s + it.qty * it.unit_price, 0) * 100) / 100;
    if (body.quoted_price === undefined) {
      update.quoted_price = items.length > 0 ? itemsTotal : Math.max(0, Number(body.quoted_price) || 0);
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  try {
    const cols = Object.keys(update);
    const set = cols.map((k, i) => `${k} = $${i + 1}`).join(", ");
    await withTransaction(async (tx) => {
      await tx.queryVoid(`UPDATE quotes SET ${set} WHERE id = $${cols.length + 1}`, [
        ...cols.map((k) => update[k]),
        id,
      ]);
      // Equipo (ediciones desde la orden de taller): columna opcional
      // (migrate-equipment.sql); sin la columna se ignora en silencio.
      if (body.equipment_id !== undefined) {
        const hasEqCol = await hasColumn(tx, "quotes", "equipment_id");
        if (hasEqCol) {
          const eqId =
            typeof body.equipment_id === "string" && /^[0-9a-f-]{36}$/i.test(body.equipment_id)
              ? body.equipment_id
              : null;
          await tx.queryVoid(`UPDATE quotes SET equipment_id = $1 WHERE id = $2`, [eqId, id]);
        }
      }
      // Reemplazo de partidas: DELETE + INSERT en la misma tx (la edición
      // manda la lista completa, como el POST). Tolerante a migración
      // pendiente: sin tabla/columna se informa y no se pisa nada.
      if (items !== null) {
        const hasItemsTable = await hasTable(tx, "quote_items");
        if (hasItemsTable) {
          const hasProductCol = await hasColumn(tx, "quote_items", "product_id").catch(() => false);
          await tx.queryVoid(`DELETE FROM quote_items WHERE quote_id = $1`, [id]);
          for (const it of items) {
            if (hasProductCol) {
              await tx.queryVoid(
                `INSERT INTO quote_items (quote_id, kind, description, qty, unit_price, position, product_id, variant_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [id, it.kind, it.description, it.qty, it.unit_price, it.position, it.product_id, it.variant_id]
              );
            } else {
              await tx.queryVoid(
                `INSERT INTO quote_items (quote_id, kind, description, qty, unit_price, position)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [id, it.kind, it.description, it.qty, it.unit_price, it.position]
              );
            }
          }
        }
      }
      // Aceptar suma el trabajo al libro del cliente (una sola vez).
      // Las consultas de prueba no tocan el libro.
      if (update.status === "accepted" && existing.status !== "accepted") {
        const isPreviewQuote = await isPreviewRow("quotes", id);
        const row = await tx.query<{ quoted_price: number | null }>(
          `SELECT quoted_price FROM quotes WHERE id = $1 LIMIT 1`,
          [id]
        );
        if (!isPreviewQuote) {
          await addServiceJob(tx, gate.vendor.id, {
            phone: existing.customer_phone,
            name: existing.customer_name,
            total: Number(row[0]?.quoted_price) || 0,
          });
        }
        // Si el presupuesto es de una orden de servicio, al aceptarlo la
        // orden pasa a "Aprobada" (ya se puede reparar). Tolerante a filas
        // viejas mal clasificadas como turno: con datos de orden alcanza.
        const hasOrderCol = await hasColumn(tx, "bookings", "quote_id");
        if (hasOrderCol) {
          await tx.queryVoid(
            `UPDATE bookings SET status = 'approved'
              WHERE quote_id = $1 AND vendor_id = $2
                AND (kind = 'orden' OR work_order_no IS NOT NULL OR declared_issue IS NOT NULL)
                AND status NOT IN ('approved', 'repairing', 'ready', 'completed', 'cancelled')`,
            [id, gate.vendor.id]
          );
        }
      }
    });
  } catch (e) {
    // Con partidas no hay fallback parcial: o se guarda todo (partidas +
    // precio, misma tx) o nada — la tx ya hizo rollback. Un mensaje que
    // nombre la migración evita "se guardó" con partidas viejas.
    if (items !== null) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-service-manual.sql en la base" },
        { status: 400 }
      );
    }
    // Columna quoted_price aún no migrada.
    if (!("quoted_price" in update)) throw e;
    const { quoted_price: _drop, ...rest } = update;
    if (Object.keys(rest).length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
    }
    const cols = Object.keys(rest);
    const set = cols.map((k, i) => `${k} = $${i + 1}`).join(", ");
    await query(`UPDATE quotes SET ${set} WHERE id = $${cols.length + 1}`, [
      ...cols.map((k) => rest[k]),
      id,
    ]);
  }

  const quote = await queryOne<Record<string, unknown>>(
    `SELECT * FROM quotes WHERE id = $1 LIMIT 1`,
    [id]
  );

  // Aviso al cliente (push si tiene cuenta; si no, link de WhatsApp).
  if (quote && (update.status === "responded" || update.status === "accepted")) {
    const phone = quote.customer_phone as string | undefined;
    const price = update.quoted_price != null ? Number(update.quoted_price) : Number(quote.quoted_price) || null;
    const isEstetica = gate.vendor.vertical === "estetica" || gate.vendor.vertical === "salud";
    await notifyServiceClient(phone, {
      title: update.status === "accepted"
        ? isEstetica ? "Consulta aceptada ✅" : "Presupuesto aceptado ✅"
        : isEstetica ? "Te respondieron la consulta 💬" : "Respondieron tu presupuesto 💬",
      body:
        update.status === "accepted"
          ? isEstetica
            ? "La profesional aceptó tu consulta. Coordinan por WhatsApp."
            : "El profesional aceptó el trabajo. Coordinan por WhatsApp."
          : price != null
            ? `Te cotizaron $${price.toLocaleString("es-AR")}. Respondé por WhatsApp para confirmar.`
            : isEstetica
              ? "Te respondieron la consulta. Revisala por WhatsApp."
              : "Te respondieron el presupuesto. Revisalo por WhatsApp.",
    });
  }

  return NextResponse.json({ quote });
}

/**
 * Borra una consulta SOLO si es de prueba (is_preview). Las reales no se
 * borran (se descartan). Espejo del borrado de pedidos de prueba.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const row = await queryOne<{ vendor_id: string; is_preview: boolean | null }>(
    `SELECT vendor_id, is_preview FROM quotes WHERE id = $1 LIMIT 1`,
    [id]
  ).catch(() =>
    queryOne<{ vendor_id: string; is_preview: boolean | null }>(
      `SELECT vendor_id, NULL::boolean AS is_preview FROM quotes WHERE id = $1 LIMIT 1`,
      [id]
    ).catch(() => null)
  );
  if (!row) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (row.vendor_id !== gate.vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (row.is_preview !== true) {
    return NextResponse.json({ error: "Solo se pueden borrar consultas de prueba" }, { status: 400 });
  }
  await query(`DELETE FROM quotes WHERE id = $1 AND vendor_id = $2`, [id, gate.vendor.id]);
  return NextResponse.json({ ok: true });
}
