import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("crm")) {
    return NextResponse.json(
      { error: "El libro de clientes forma parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const payload: Record<string, unknown> = {};
  if (body?.name !== undefined) payload.name = body.name ? String(body.name).trim().slice(0, 120) : null;
  if (body?.address !== undefined) payload.address = body.address ? String(body.address).trim().slice(0, 300) : null;
  if (body?.notes !== undefined) payload.notes = body.notes ? String(body.notes).trim().slice(0, 500) : null;

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
  }

  const setClauses = Object.keys(payload).map((k, i) => `${k} = $${i + 3}`);
  const values = [id, gate.vendor.id, ...Object.values(payload)];

  const customer = await queryOne<Record<string, any>>(
    `UPDATE customers SET ${setClauses.join(", ")} WHERE id = $1 AND vendor_id = $2 RETURNING *`,
    values
  );

  if (!customer) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  return NextResponse.json({ ok: true, customer });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("crm")) {
    return NextResponse.json(
      { error: "El libro de clientes forma parte del plan Gestión integral", code: "plan_limit" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const customer = await queryOne<Record<string, any>>(
    `SELECT * FROM customers WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );
  if (!customer) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });

  const orders = await queryMany<Record<string, any>>(
    `SELECT id, items, total, status, method, payment_method, created_at
     FROM orders
     WHERE vendor_id = $1
       AND (regexp_replace(customer_phone, '[^0-9]', '', 'g') = ANY($2))
     ORDER BY created_at DESC
     LIMIT 30`,
    [
      gate.vendor.id,
      // Mismo matching tolerante a formato que el resto de la app: E.164,
      // nacional y variantes sin el 9 móvil.
      buildPhoneVariants(customer.phone),
    ]
  );

  return NextResponse.json({ customer, orders: orders || [] });
}

/** Variantes en dígitos del teléfono (para matchear sin importar el formato guardado). */
function buildPhoneVariants(phone: string): string[] {
  const d = (phone || "").replace(/[^\d]/g, "");
  if (!d) return [];
  const out = new Set<string>([d]);
  if (d.length === 13 && d.startsWith("549")) {
    const core = d.slice(3);
    out.add(core);
    out.add("54" + core);
  } else if (d.length === 10) {
    out.add("54" + d);
    out.add("549" + d);
  }
  return Array.from(out);
}
