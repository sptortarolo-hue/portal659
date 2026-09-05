import type { Tx } from "@/lib/db";

/**
 * Número de pedido correlativo del día (timezone Argentina) por comercio.
 * Se aplica a TODOS los canales (app / mostrador / mesa) y métodos de entrega:
 * el staff lo ve el mismo en el chat ("Retiro 3", "Envío 4", "Nro. 5"), y se
 * reinicia a 1 cada día.
 *
 * Advisory lock por vendor (pg_advisory_xact_lock) => no hay dos números
 * iguales aunque entren 2 pedidos al mismo tiempo.
 */
export async function nextOrderNumber(
  tx: Pick<Tx, "query" | "queryOne">,
  vendorId: string
): Promise<number> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`ordernum:${vendorId}`]);
  const row = await tx.queryOne<{ n: number }>(
    `SELECT COALESCE(MAX(pickup_number), 0)::int AS n
     FROM orders
     WHERE vendor_id = $1 AND pickup_number IS NOT NULL
       AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
           = (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`,
    [vendorId]
  );
  return (row?.n ?? 0) + 1;
}
