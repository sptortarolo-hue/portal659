import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { getVendorMpToken } from "@/lib/mp-oauth";
import { sendPushToUser } from "@/lib/push";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const simulate = url.searchParams.get("simulate") === "1";
  const gate = await (async () => {
    try {
      const { vendor, previewSession } = await getVendorByRequest(request);
      return { vendor, previewSession };
    } catch {
      return null;
    }
  })();
  if (!gate?.vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const vendorId = (gate.vendor as any).id as string;
  const isPreview = gate.previewSession === true;

  const row = await queryOne<{
    id: string;
    status: string;
    amount: number;
    paid_at: string | null;
    expires_at: string | null;
    order_id: string | null;
    mp_order_id: string | null;
    vendor_id: string;
  }>(
    `SELECT id, status, amount, paid_at, expires_at, order_id, mp_order_id, vendor_id
     FROM mp_qr_orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, vendorId]
  );

  if (!row) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  const markPaid = async (paymentId: string | null) => {
    await queryOne(
      `UPDATE mp_qr_orders SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = $1`,
      [id]
    );
    if (row.order_id) {
      try {
        await queryOne(
          `UPDATE orders SET payment_status = 'paid', paid_at = now(), payment_method = 'mercadopago' WHERE id = $1`,
          [row.order_id]
        );
      } catch { /* columnas sin migrar */ }
    }
    try {
      const v = await queryOne<{ user_id: string }>(
        `SELECT user_id FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorId]
      );
      if (v?.user_id) {
        await sendPushToUser(v.user_id, {
          title: "Cobro QR acreditado",
          body: `Se acreditó un cobro por QR de $${row.amount}.`,
          link: "/vendor/dashboard",
        });
      }
    } catch { /* push best-effort */ }
    row.status = "paid";
    row.paid_at = new Date().toISOString();
  };

  // Simulación en preview: marca como pagada.
  if (simulate && isPreview && row.status === "pending") {
    await markPaid(null);
    return NextResponse.json(row);
  }

  // Expirar si pasó el tiempo (solo si no es preview).
  if (!isPreview && row.status === "pending" && row.expires_at && new Date(row.expires_at) < new Date()) {
    await queryOne(`UPDATE mp_qr_orders SET status = 'expired', updated_at = now() WHERE id = $1`, [id]);
    row.status = "expired";
    return NextResponse.json(row);
  }

  // Polling activo: si sigue pendiente, consultar a MP el estado real.
  if (!isPreview && row.status === "pending" && row.mp_order_id) {
    try {
      const vendor = await queryOne<any>(
        `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorId]
      );
      if (vendor) {
        const token = await getVendorMpToken(vendor);
        if (token) {
          const res = await fetch(`https://api.mercadopago.com/v1/orders/${row.mp_order_id}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const order = await res.json().catch(() => null);
          console.log(`[mp-qr poll] order=${row.mp_order_id} status=${order?.status} ext=${order?.external_reference}`);
          if (order?.status === "processed") {
            await markPaid(row.mp_order_id);
          } else if (order?.status === "canceled" || order?.status === "expired") {
            await queryOne(`UPDATE mp_qr_orders SET status = 'expired', updated_at = now() WHERE id = $1`, [id]);
            row.status = "expired";
          }
        }
      }
    } catch (e) {
      console.warn("[mp-qr poll] error:", (e as any)?.message);
    }
  }

  return NextResponse.json(row);
}
