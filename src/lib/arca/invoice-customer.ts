import { queryOne } from "@/lib/db";

/**
 * SQL tolerant para traer el cliente de una factura, venga de un pedido o de un
 * turno. Todas las columnas se prueban antes de usarse: las migraciones
 * `migrate-fiscal-receptor.sql`, `migrate-estetica-booking-payment.sql` y
 * `migrate-service-requests.sql` pueden no estar aplicadas en el VPS.
 *
 * Los fragmentos devueltos se interpolan en queries con alias fijos:
 *   FROM invoices i LEFT JOIN orders o ON o.id = i.order_id ${join}
 */
export type InvoiceCustomerSql = {
  join: string;
  /** Expresión que prioriza el receptor escrito al emitir, luego pedido, luego turno. */
  customerExpr: string;
  /** Columnas extra para el historial (booking_id y datos del turno). */
  extraCols: string;
  hasBookingRef: boolean;
  hasBookingName: boolean;
};

async function hasColumn(table: string, column: string): Promise<boolean> {
  const row = await queryOne<{ e: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS e`,
    [table, column]
  ).catch(() => ({ e: false }));
  return row?.e === true;
}

export async function invoiceCustomerSql(): Promise<InvoiceCustomerSql> {
  const [hasBookingRef, hasBookingName, hasReceptorName] = await Promise.all([
    hasColumn("invoices", "booking_id"),
    hasColumn("bookings", "customer_name"),
    hasColumn("invoices", "receptor_nombre"),
  ]);

  const parts = [
    ...(hasReceptorName ? ["i.receptor_nombre"] : []),
    "o.customer_name",
    ...(hasBookingRef && hasBookingName ? ["b.customer_name"] : []),
  ];

  return {
    join: hasBookingRef ? "LEFT JOIN bookings b ON b.id = i.booking_id" : "",
    customerExpr: `COALESCE(${parts.join(", ")})`,
    extraCols: hasBookingRef
      ? `, i.booking_id${
          hasBookingName
            ? `, b.customer_name AS booking_customer_name, b.customer_phone AS booking_customer_phone`
            : ""
        }`
      : "",
    hasBookingRef,
    hasBookingName,
  };
}
