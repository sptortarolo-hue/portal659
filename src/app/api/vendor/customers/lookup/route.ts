import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { customerMatches, searchTokens, tokenDigits } from "@/lib/search-match";
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
 * - `?q=`: ≥2 caracteres, match por tokens en nombre/dirección (insensible
 *   a tildes) o dígitos en teléfono. "juan 221" exige ambas partes.
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

    // Búsqueda por tokens: cada palabra debe aparecer en nombre, dirección
    // o (con ≥2 dígitos) en el teléfono. Insensible a tildes vía translate()
    // (sin extensión unaccent). "juan 221" matchea nombre+juan y tel+221.
    const TR_FROM = "áéíóúñãõàèìòùâêîôûäëïöüç";
    const TR_TO = "aeiounaoaeiouaeiouaeiouc";
    const trCol = (col: string) =>
      `translate(lower(COALESCE(${col},'')), '${TR_FROM}', '${TR_TO}')`;
    const tokens = searchTokens(q);
    const conds: string[] = [];
    const params: unknown[] = [vendorId];
    for (const t of tokens) {
      const td = tokenDigits(t);
      if (td.length >= 2) {
        params.push(td, t);
        const a = params.length - 1;
        const b = params.length;
        conds.push(
          `(phone LIKE '%' || $${a} || '%' OR ${trCol("name")} LIKE '%' || $${b} || '%' OR ${trCol("address")} LIKE '%' || $${b} || '%')`
        );
      } else {
        params.push(t);
        const a = params.length;
        conds.push(
          `(${trCol("name")} LIKE '%' || $${a} || '%' OR ${trCol("address")} LIKE '%' || $${a} || '%')`
        );
      }
    }
    let rows: LookupCustomer[];
    try {
      rows =
        (await queryMany<LookupCustomer>(
          `SELECT phone, name, address, total_orders
           FROM customers
           WHERE vendor_id = $1 AND ${conds.join(" AND ")}
           ORDER BY last_order_at DESC NULLS LAST, total_spent DESC
           LIMIT 8`,
          params
        )) || [];
    } catch {
      // Fallback legacy (una sola condición ILIKE).
      rows =
        (await queryMany<LookupCustomer>(
          `SELECT phone, name, address, total_orders
           FROM customers
           WHERE vendor_id = $1
             AND (phone LIKE '%' || $2 || '%' OR name ILIKE '%' || $3 || '%')
           ORDER BY last_order_at DESC NULLS LAST, total_spent DESC
           LIMIT 8`,
          [vendorId, q.replace(/[^\d]/g, ""), q]
        ).catch(() => [])) || [];
    }
    // Refuerzo en JS (misma regla en todos lados): por si el SQL difiere.
    rows = rows.filter((r) => customerMatches(r, q));
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
      const filtered = (rows || [])
        .filter((r) =>
          customerMatches(
            {
              name: r.name ? String(r.name) : null,
              phone: String(r.phone || ""),
              address: r.address ? String(r.address) : null,
            },
            q
          )
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
