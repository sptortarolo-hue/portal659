import { gateRequest } from "@/lib/subscription-gate";
import { queryMany, withTransaction } from "@/lib/db";
import { ensureServiceCustomer } from "@/lib/customers";
import { toE164 } from "@/lib/phone";
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
    `SELECT id, customer_name, customer_phone, service_name, description,
            preferred_date, preferred_time, status, vendor_notes, quoted_price,
            deposit_amount, deposit_pct, deposit_status, photo_urls, created_at
     FROM quotes WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT 100`,
    params
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
  if (gate.vendor.vertical !== "servicio") {
    return NextResponse.json({ error: "Solo disponible para servicios" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const customerName = String(body.customer_name || "").trim();
  const customerPhone = toE164(String(body.customer_phone || ""));
  const description = String(body.description || "").trim();
  if (!customerName || !customerPhone || !description) {
    return NextResponse.json({ error: "Faltan cliente, teléfono o descripción" }, { status: 400 });
  }

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

  let quoteId: string | null = null;
  try {
    quoteId = await withTransaction(async (tx) => {
      const q = await tx.query<{ id: string }>(
        `INSERT INTO quotes (vendor_id, customer_name, customer_phone, service_name, description, preferred_date, preferred_time, status, vendor_notes, quoted_price, origin)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'responded', $8, $9, 'vendor') RETURNING id`,
        [
          gate.vendor.id,
          customerName,
          customerPhone,
          String(body.service_name || "").trim() || null,
          description,
          String(body.preferred_date || "").trim() || null,
          String(body.preferred_time || "").trim() || null,
          String(body.vendor_notes || "").trim().slice(0, 2000) || null,
          quotedPrice,
        ]
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
      await ensureServiceCustomer(tx, gate.vendor.id, { phone: customerPhone, name: customerName });
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
