import type { Tx } from "@/lib/db";
import { toE164 } from "@/lib/phone";

/**
 * Libro de clientes (CRM v1): fichas derivadas de los pedidos con teléfono
 * real del cliente. La usan la creación de pedidos (app, mostrador delivery,
 * MP) para crear/actualizar la ficha en la misma transacción, y la
 * cancelación para restar la compra anulada.
 *
 * No generan ficha:
 *  - mesa / mostrador-retiro: el customer_phone guarda el WA del comercio,
 *  - chats del bot sin teléfono real ("lid:<id>", no se les puede escribir).
 */

export type CustomerOrderInput = {
  phone: string;
  name?: string | null;
  address?: string | null;
  total?: number | null;
  at?: string | null;
};

/** ¿El teléfono corresponde a un cliente real (y no al WA del comercio)? */
export function isRealCustomerPhone(
  phone: string | null | undefined,
  vendorWhatsapp: string | null | undefined
): boolean {
  const e = toE164(phone || "");
  if (!e) return false;
  const wa = toE164(vendorWhatsapp || "");
  return !wa || e !== wa;
}

/** Upsert de la ficha: 1 pedido más + gasto + última compra (nombre/dirección completan). */
export async function upsertCustomerFromOrder(
  tx: Tx,
  vendorId: string,
  input: CustomerOrderInput
): Promise<void> {
  const phone = (input.phone || "").trim();
  if (!phone || phone.startsWith("lid:")) return;

  const total = Math.max(0, Number(input.total) || 0);
  const at = input.at || new Date().toISOString();

  await tx.queryVoid(
    `INSERT INTO customers (vendor_id, phone, name, address, last_order_at, total_orders, total_spent)
     VALUES ($1, $2, $3, $4, $5, 1, $6)
     ON CONFLICT (vendor_id, phone) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, customers.name),
       address = COALESCE(EXCLUDED.address, customers.address),
       last_order_at = GREATEST(COALESCE(customers.last_order_at, to_timestamp(0)), EXCLUDED.last_order_at),
       total_orders = customers.total_orders + 1,
       total_spent = customers.total_spent + EXCLUDED.total_spent`,
    [vendorId, phone, input.name || null, input.address || null, at, total]
  );
}

/** Resta la compra de un pedido cancelado (el libro queda con compras reales). */
export async function decrementCustomerFromOrder(
  tx: Tx,
  vendorId: string,
  input: CustomerOrderInput
): Promise<void> {
  const phone = (input.phone || "").trim();
  if (!phone || phone.startsWith("lid:")) return;

  const total = Math.max(0, Number(input.total) || 0);

  await tx.queryVoid(
    `UPDATE customers SET
       total_orders = GREATEST(total_orders - 1, 0),
       total_spent = GREATEST(total_spent - $1, 0)
     WHERE vendor_id = $2 AND phone = $3`,
    [total, vendorId, phone]
  );
}
