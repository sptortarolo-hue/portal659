import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

export type LookupCustomer = {
  phone: string;
  name: string | null;
  address: string | null;
  total_orders: number;
};

/**
 * Lookup liviano de clientes para el mostrador (autocomplete por teléfono
 * o nombre + frecuentes). Gate `pos`, NO `crm`: la ficha ya la escribe
 * `pos/order` al cobrar, así que todo plan con Mostrador puede leerla.
 *
 * - `?q=`: ≥2 caracteres, match por dígitos en teléfono o ILIKE en nombre.
 * - sin `q`: devuelve los 4 más recientes (fila "Frecuentes" del picker).
 * - Fallback: si la tabla `customers` no existe (migración sin aplicar),
 *   deriva candidatos de `orders` recientes (mismo shape, total_orders 0).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "El mostrador forma parte de los planes pagos", code: "plan_limit" },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const digits = q.replace(/[^\d]/g, "");
  const vendorId = gate.vendor.id;

  try {
    if (!q) {
      const rows = await queryMany<LookupCustomer>(
        `SELECT phone, name, address, total_orders
         FROM customers
         WHERE vendor_id = $1
         ORDER BY last_order_at DESC NULLS LAST, total_spent DESC
         LIMIT 4`,
        [vendorId]
      );
      return NextResponse.json({ customers: rows || [] });
    }

    const hasDigits = digits.length >= 2;
    const rows = hasDigits
      ? await queryMany<LookupCustomer>(
          `SELECT phone, name, address, total_orders
           FROM customers
           WHERE vendor_id = $1
             AND (phone LIKE '%' || $2 || '%' OR name ILIKE '%' || $3 || '%')
           ORDER BY last_order_at DESC NULLS LAST, total_spent DESC
           LIMIT 8`,
          [vendorId, digits, q]
        )
      : await queryMany<LookupCustomer>(
          `SELECT phone, name, address, total_orders
           FROM customers
           WHERE vendor_id = $1
             AND name ILIKE '%' || $2 || '%'
           ORDER BY last_order_at DESC NULLS LAST, total_spent DESC
           LIMIT 8`,
          [vendorId, q]
        );
    return NextResponse.json({ customers: rows || [] });
  } catch {
    // Sin tabla customers (migración pendiente): derivar de pedidos recientes.
    try {
      const rows = await queryMany<Record<string, any>>(
        `SELECT DISTINCT ON (customer_phone)
           customer_phone AS phone,
           customer_name AS name,
           customer_address AS address,
           created_at
         FROM orders
         WHERE vendor_id = $1
           AND customer_phone IS NOT NULL
           AND customer_phone <> ''
           AND created_at > now() - interval '90 days'
         ORDER BY customer_phone, created_at DESC
         LIMIT 60`,
        [vendorId]
      );
      const ql = q.toLowerCase();
      const hasDigits = digits.length >= 2;
      const filtered = (rows || [])
        .filter(
          (r) =>
            (hasDigits && String(r.phone || "").replace(/[^\d]/g, "").includes(digits)) ||
            String(r.name || "").toLowerCase().includes(ql)
        )
        .slice(0, q ? 8 : 4)
        .map((r) => ({
          phone: String(r.phone),
          name: r.name ? String(r.name) : null,
          address: r.address ? String(r.address) : null,
          total_orders: 0,
        }));
      return NextResponse.json({ customers: filtered });
    } catch {
      return NextResponse.json({ customers: [] });
    }
  }
}
