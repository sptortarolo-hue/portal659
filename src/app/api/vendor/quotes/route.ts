import { gateRequest } from "@/lib/subscription-gate";
import { queryMany, withTransaction, hasColumn } from "@/lib/db";
import { ensureServiceCustomer } from "@/lib/customers";
import { toE164 } from "@/lib/phone";
import { resolveEquipmentForWorkTx, hasEquipmentColumnTx } from "@/lib/equipment-server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Bandeja de presupuestos del comercio (ver + responder). */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const conditions = [`vendor_id = $1`];
  const params: unknown[] = [gate.vendor.id];
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const quotes = await queryMany<Record<string, unknown>>(
    `SELECT q.id, q.customer_name, q.customer_phone, q.service_name, q.description,
            q.preferred_date, q.preferred_time, q.status, q.vendor_notes, q.quoted_price,
            q.deposit_amount, q.deposit_pct, q.deposit_status, q.photo_urls, q.is_preview, q.created_at,
            q.booking_id, q.quote_type,
            e.kind AS equipment_kind, e.brand AS equipment_brand, e.model AS equipment_model,
            e.identifier AS equipment_identifier, e.rodado AS equipment_rodado, e.color AS equipment_color
     FROM quotes q LEFT JOIN equipment e ON e.id = q.equipment_id
     WHERE ${conditions
        .join(" AND ")
        .replace(/vendor_id/g, "q.vendor_id")
        .replace(/status/g, "q.status")} ORDER BY q.created_at DESC LIMIT 100`,
    params
  ).catch(() =>
    // Sin flag de prueba: sin columna.
    queryMany<Record<string, unknown>>(
      `SELECT id, customer_name, customer_phone, service_name, description,
              preferred_date, preferred_time, status, vendor_notes, quoted_price,
              deposit_amount, deposit_pct, deposit_status, photo_urls, created_at
       FROM quotes WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT 100`,
      params
    )
  ).catch(() =>
    // Migración de seña aún no aplicada: sin columnas de depósito.
    queryMany<Record<string, unknown>>(
      `SELECT id, customer_name, customer_phone, service_name, description,
              preferred_date, preferred_time, status, vendor_notes, quoted_price, photo_urls,
              created_at
       FROM quotes WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT 100`,
      params
    )
  ).catch(() =>
    queryMany<Record<string, unknown>>(
      `SELECT id, customer_name, customer_phone, service_name, description,
              preferred_date, preferred_time, status, vendor_notes, quoted_price,
              created_at
       FROM quotes WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT 100`,
      params
    )
  ).catch(() =>
    queryMany<Record<string, unknown>>(
      `SELECT id, customer_name, customer_phone, service_name, description,
              preferred_date, preferred_time, status, vendor_notes, created_at
       FROM quotes WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT 100`,
      params
    )
  );

  return NextResponse.json({
    quotes: quotes || [],
    canQuotePrice: gate.plan.can("quotes_respond"),
    canDeposits: gate.plan.can("deposits"),
  });
}

type ManualItem = {
  kind?: string;
  description?: string;
  qty?: number;
  unit_price?: number;
};

/**
 * Crear presupuesto MANUAL desde el panel (no cuenta para el tope gratuito:
 * origin='vendor'). Nace respondido con precio = suma de partidas.
 */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (gate.vendor.vertical !== "servicio" && (gate.vendor.vertical !== "estetica" && gate.vendor.vertical !== "salud" && gate.vendor.vertical !== "taller")) {
    return NextResponse.json({ error: "Solo disponible para servicios, estética y talleres" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const customerName = String(body.customer_name || "").trim();
  const customerPhone = toE164(String(body.customer_phone || ""));
  const description = String(body.description || "").trim();
  if (!customerName || !customerPhone || !description) {
    return NextResponse.json({ error: "Faltan cliente, teléfono o descripción" }, { status: 400 });
  }
  const quoteType = body.quote_type === "orden" ? "orden" : "consulta";
  const bookingId = typeof body.booking_id === "string" && /^[0-9a-f-]{36}$/i.test(body.booking_id)
    ? body.booking_id
    : null;

  const rawItems: ManualItem[] = Array.isArray(body.items) ? body.items : [];
  const items = rawItems
    .map((it, i) => ({
      kind: it.kind === "labor" ? "labor" : "material",
      description: String(it.description || "").trim(),
      qty: Math.max(0, Number(it.qty) || 0),
      unit_price: Math.max(0, Number(it.unit_price) || 0),
      position: i,
    }))
    .filter((it) => it.description !== "")
    .slice(0, 30);
  const itemsTotal = Math.round(items.reduce((s, it) => s + it.qty * it.unit_price, 0) * 100) / 100;
  const quotedPrice =
    items.length > 0 ? itemsTotal : Math.max(0, Number(body.quoted_price) || 0);

  // Si es tipo orden sin booking_id, forzar a consulta (no puede ser orden sin orden vinculada).
  const finalType = quoteType === "orden" && !bookingId ? "consulta" : quoteType;

  let quoteId: string | null = null;
  const isPreview = gate.previewSession === true;
  try {
    quoteId = await withTransaction(async (tx) => {
      const eqId = bookingId ? null : await resolveEquipmentForWorkTx(tx, gate.vendor.id, body, {
        name: customerName,
        phone: customerPhone,
      });
      const hasEqCol = eqId ? await hasEquipmentColumnTx(tx, "quotes") : false;
      const hasBookingCol = await hasColumn(tx, "quotes", "booking_id");
      const hasTypeCol = await hasColumn(tx, "quotes", "quote_type");

      // Construir columnas dinámicamente para tolerar migración pendiente.
      const cols: string[] = [
        "vendor_id", "customer_name", "customer_phone", "service_name", "description",
        "preferred_date", "preferred_time", "status", "vendor_notes", "quoted_price",
        "origin", "is_preview",
      ];
      const vals: unknown[] = [
        gate.vendor.id, customerName, customerPhone,
        String(body.service_name || "").trim() || null,
        description,
        String(body.preferred_date || "").trim() || null,
        String(body.preferred_time || "").trim() || null,
        "responded",
        String(body.vendor_notes || "").trim().slice(0, 2000) || null,
        quotedPrice,
        "vendor",
        isPreview,
      ];
      if (hasBookingCol) {
        cols.push("booking_id");
        vals.push(bookingId);
      }
      if (hasTypeCol) {
        cols.push("quote_type");
        vals.push(finalType);
      }
      if (hasEqCol && eqId) {
        cols.push("equipment_id");
        vals.push(eqId);
      }

      const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
      const q = await tx.query<{ id: string }>(
        `INSERT INTO quotes (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id`,
        vals
      );
      const id = q[0]?.id;
      if (!id) throw new Error("No se pudo crear el presupuesto");
      for (const it of items) {
        await tx.queryVoid(
          `INSERT INTO quote_items (quote_id, kind, description, qty, unit_price, position)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, it.kind, it.description, it.qty, it.unit_price, it.position]
        );
      }
      if (!isPreview) {
        await ensureServiceCustomer(tx, gate.vendor.id, { phone: customerPhone, name: customerName });
      }
      return id;
    });
  } catch (e) {
    if (/origin|quote_items/i.test((e as Error)?.message || "")) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-service-manual.sql en la base" },
        { status: 400 }
      );
    }
    throw e;
  }

  const quote = await queryMany<Record<string, unknown>>(
    `SELECT * FROM quotes WHERE id = $1 LIMIT 1`,
    [quoteId]
  ).catch(() => []);
  return NextResponse.json({ quote: quote?.[0] || { id: quoteId } });
}
