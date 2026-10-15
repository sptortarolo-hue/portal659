import type { Tx } from "@/lib/db";

/**
 * Número de pedido correlativo por comercio (todos los canales: app /
 * mostrador / mesa; el staff lo ve igual en el chat, tickets y tableros).
 *
 * - Gastronomía: se reinicia a 1 cada día (timezone Argentina). La cocina
 *   grita números cortos y el KDS no mezcla días (patrón Square food).
 * - Resto (comercio/moda/otros): correlativo continuo, sin reset. El comercio
 *   de barrio entrega diferido en otro día y los números repetidos se
 *   confunden (patrón Square retail).
 *
 * Advisory lock por vendor (pg_advisory_xact_lock) => no hay dos números
 * iguales aunque entren 2 pedidos al mismo tiempo.
 */
export async function nextOrderNumber(
  tx: Pick<Tx, "query" | "queryOne">,
  vendorId: string
): Promise<number> {
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`ordernum:${vendorId}`]);
  const vrow = await tx
    .queryOne<{ vertical: string | null }>(`SELECT vertical FROM vendors WHERE id = $1 LIMIT 1`, [
      vendorId,
    ])
    .catch(() => null);
  // Solo gastronomía reinicia a diario; cualquier otro caso (incluida DB
  // vieja o vertical nulo) usa correlativo continuo, que nunca colisiona.
  if (String(vrow?.vertical || "") === "gastronomia") {
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
  const row = await tx.queryOne<{ n: number }>(
    `SELECT COALESCE(MAX(pickup_number), 0)::int AS n
     FROM orders
     WHERE vendor_id = $1 AND pickup_number IS NOT NULL`,
    [vendorId]
  );
  return (row?.n ?? 0) + 1;
}
