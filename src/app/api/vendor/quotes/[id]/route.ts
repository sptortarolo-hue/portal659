import { gateRequest } from "@/lib/subscription-gate";
import { notifyServiceClient } from "@/lib/service-notify";
import { query, queryOne } from "@/lib/db";
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
  const existing = await queryOne<{ id: string; vendor_id: string }>(
    `SELECT id, vendor_id FROM quotes WHERE id = $1 LIMIT 1`,
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

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
  }

  try {
    const cols = Object.keys(update);
    const set = cols.map((k, i) => `${k} = $${i + 1}`).join(", ");
    await query(`UPDATE quotes SET ${set} WHERE id = $${cols.length + 1}`, [
      ...cols.map((k) => update[k]),
      id,
    ]);
  } catch (e) {
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
    await notifyServiceClient(phone, {
      title: update.status === "accepted" ? "Presupuesto aceptado ✅" : "Respondieron tu presupuesto 💬",
      body:
        update.status === "accepted"
          ? "El profesional aceptó el trabajo. Coordinan por WhatsApp."
          : price != null
            ? `Te cotizaron $${price.toLocaleString("es-AR")}. Respondé por WhatsApp para confirmar.`
            : "Te respondieron el presupuesto. Revisalo por WhatsApp.",
    });
  }

  return NextResponse.json({ quote });
}
