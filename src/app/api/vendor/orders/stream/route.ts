import { getVendorByRequest } from "@/lib/vendor-utils";
import { getPool } from "@/lib/db";
import { attachShipments } from "@/lib/shipping-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) {
    return new Response(JSON.stringify({ error: "No autenticado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let lastCheck = new Date().toISOString();

      // Send initial heartbeat
      controller.enqueue(encoder.encode(`:ok\n\n`));

      const interval = setInterval(async () => {
        if (closed) return;
        try {
          const pool = getPool();
          // SELECT *: el cliente REEMPLAZA el pedido con esta fila, así que
          // cualquier columna que falte "desaparece" del panel (pasó con
          // shipping_zone_id — se caía el bloque de logística — y antes con
          // kitchen_done). `*` trae todas las columnas existentes y es
          // tolerante a migraciones sin aplicar.
          const { rows } = await pool.query(
            `SELECT * FROM orders
             WHERE vendor_id = $1 AND updated_at > $2
             ORDER BY updated_at ASC
             LIMIT 20`,
            [vendor.id, lastCheck]
          );

          if (rows.length > 0) {
            lastCheck = new Date().toISOString();
            // Envío embebido (Portal 659 Envíos) para que el pill violeta y el
            // estado de la logística también se actualicen en vivo.
            await attachShipments(rows, vendor.id).catch(() => {});
            const payload = JSON.stringify({ type: "orders_update", orders: rows });
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          }

          // Keepalive comment every cycle
          controller.enqueue(encoder.encode(`:ping\n\n`));
        } catch {
          // DB error — send keepalive to keep connection open
          controller.enqueue(encoder.encode(`:ping\n\n`));
        }
      }, 3000);

      // Heartbeat every 15s to prevent proxy timeouts
      const heartbeat = setInterval(() => {
        if (closed) return;
        controller.enqueue(encoder.encode(`:heartbeat\n\n`));
      }, 15000);

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
