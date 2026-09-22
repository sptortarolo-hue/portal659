import { gateRequest } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
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
