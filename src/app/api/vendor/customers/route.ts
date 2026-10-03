import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";

const INACTIVE_DAYS = 30;

export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("crm")) {
    return NextResponse.json(
      { error: "El libro de clientes forma parte de los planes pagos", code: "plan_limit" },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const format = url.searchParams.get("format") || "json";

  // Ficha extendida (estética): allergies/skin_notes/consent_at viven en
  // migrate-estetica.sql; birthdate en migrate-estetica-birthday.sql.
  // Tolerante a migración sin aplicar.
  let rows;
  try {
    rows = await queryMany<Record<string, any>>(
      `SELECT id, phone, name, address, notes, allergies, skin_notes, consent_at, birthdate::text AS birthdate, last_order_at, total_orders, total_spent, created_at
       FROM customers
       WHERE vendor_id = $1
       ORDER BY last_order_at DESC NULLS LAST, total_spent DESC
       LIMIT 1000`,
      [gate.vendor.id]
    );
  } catch {
    try {
      rows = await queryMany<Record<string, any>>(
        `SELECT id, phone, name, address, notes, allergies, skin_notes, consent_at, last_order_at, total_orders, total_spent, created_at
         FROM customers
         WHERE vendor_id = $1
         ORDER BY last_order_at DESC NULLS LAST, total_spent DESC
         LIMIT 1000`,
        [gate.vendor.id]
      );
    } catch {
      rows = await queryMany<Record<string, any>>(
        `SELECT id, phone, name, address, notes, last_order_at, total_orders, total_spent, created_at
         FROM customers
         WHERE vendor_id = $1
         ORDER BY last_order_at DESC NULLS LAST, total_spent DESC
         LIMIT 1000`,
        [gate.vendor.id]
      );
    }
  }

  const inactiveCutoff = Date.now() - INACTIVE_DAYS * 24 * 60 * 60 * 1000;
  const withSegments: (Record<string, any> & { segment: "frecuente" | "nuevo" | "inactivo" | "ocasional" })[] = (rows || []).map((c) => {
    const last = c.last_order_at ? new Date(c.last_order_at).getTime() : null;
    let segment: "frecuente" | "nuevo" | "inactivo" | "ocasional" = "ocasional";
    if (last != null && last < inactiveCutoff) segment = "inactivo";
    else if ((c.total_orders || 0) >= 3) segment = "frecuente";
    else if ((c.total_orders || 0) <= 1) segment = "nuevo";
    return { ...c, segment };
  });

  const filtered = q
    ? withSegments.filter((c) =>
        (c.name || "").toLowerCase().includes(q.toLowerCase()) ||
        c.phone.includes(q.replace(/[^\d]/g, ""))
      )
    : withSegments;

  const stats = {
    total: withSegments.length,
    frecuentes: withSegments.filter((c) => c.segment === "frecuente").length,
    nuevos: withSegments.filter((c) => c.segment === "nuevo").length,
    inactivos: withSegments.filter((c) => c.segment === "inactivo").length,
    totalSpent: withSegments.reduce((s, c) => s + Number(c.total_spent || 0), 0),
  };

  if (format === "csv") {
    const header = "nombre,telefono,direccion,pedidos,total_gastado,ultima_compra,segmento";
    const lines = filtered.map((c) =>
      [
        csvCell(c.name || ""),
        csvCell(c.phone),
        csvCell(c.address || ""),
        String(c.total_orders || 0),
        String(Number(c.total_spent || 0).toFixed(2)),
        c.last_order_at ? new Date(c.last_order_at).toISOString().slice(0, 10) : "",
        c.segment,
      ].join(",")
    );
    const csv = "\uFEFF" + [header, ...lines].join("\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="clientes-portal659.csv"`,
      },
    });
  }

  return NextResponse.json({ customers: filtered, stats });
}

/** Alta manual de cliente (plan con CRM). No pisa fichas existentes. */
export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("crm")) {
    return NextResponse.json(
      { error: "El libro de clientes forma parte de los planes pagos", code: "plan_limit" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const phone = toE164(String(body.phone || ""));
  const name = String(body.name || "").trim().slice(0, 120);
  if (!phone || !name) {
    return NextResponse.json({ error: "Faltan nombre y un celular válido" }, { status: 400 });
  }

  const allergies = String(body.allergies || "").trim().slice(0, 500) || null;
  const skinNotes = String(body.skin_notes || "").trim().slice(0, 500) || null;

  let customer;
  try {
    customer = await queryOne<Record<string, unknown>>(
      `INSERT INTO customers (vendor_id, phone, name, address, notes, allergies, skin_notes, last_order_at, total_orders, total_spent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 0, 0)
       ON CONFLICT (vendor_id, phone) DO UPDATE SET
         name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name),
         address = COALESCE(NULLIF(EXCLUDED.address, ''), customers.address),
         notes = COALESCE(NULLIF(EXCLUDED.notes, ''), customers.notes),
         allergies = COALESCE(NULLIF(EXCLUDED.allergies, ''), customers.allergies),
         skin_notes = COALESCE(NULLIF(EXCLUDED.skin_notes, ''), customers.skin_notes)
       RETURNING *`,
      [
        gate.vendor.id,
        phone,
        name,
        String(body.address || "").trim().slice(0, 300) || null,
        String(body.notes || "").trim().slice(0, 500) || null,
        allergies,
        skinNotes,
      ]
    );
  } catch {
    customer = await queryOne<Record<string, unknown>>(
      `INSERT INTO customers (vendor_id, phone, name, address, notes, last_order_at, total_orders, total_spent)
       VALUES ($1, $2, $3, $4, $5, NULL, 0, 0)
       ON CONFLICT (vendor_id, phone) DO UPDATE SET
         name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name),
         address = COALESCE(NULLIF(EXCLUDED.address, ''), customers.address),
         notes = COALESCE(NULLIF(EXCLUDED.notes, ''), customers.notes)
       RETURNING *`,
      [
        gate.vendor.id,
        phone,
        name,
        String(body.address || "").trim().slice(0, 300) || null,
        String(body.notes || "").trim().slice(0, 500) || null,
      ]
    ).catch(() => undefined);
  }

  if (!customer) {
    return NextResponse.json({ error: "No se pudo guardar (¿falta la migración migrate-crm.sql?)" }, { status: 400 });
  }
  return NextResponse.json({ customer });
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
