import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";

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

  const row = await queryOne<{
    id: string;
    status: string;
    amount: number;
    paid_at: string | null;
    expires_at: string | null;
    order_id: string | null;
  }>(
    `SELECT id, status, amount, paid_at, expires_at, order_id
     FROM mp_qr_orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, (gate.vendor as any).id]
  );

  if (!row) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  // Simulación en preview: marca como pagada.
  if (simulate && gate.previewSession && row.status === "pending") {
    await queryOne(`UPDATE mp_qr_orders SET status = 'paid', paid_at = now(), updated_at = now() WHERE id = $1`, [id]);
    if (row.order_id) {
      try {
        await queryOne(`UPDATE orders SET payment_status = 'paid', paid_at = now(), payment_method = 'mercadopago' WHERE id = $1`, [row.order_id]);
      } catch { /* tolerante */ }
    }
    row.status = "paid";
    row.paid_at = new Date().toISOString();
  }

  // Expirar si pasó el tiempo (solo si no es preview).
  if (!gate.previewSession && row.status === "pending" && row.expires_at && new Date(row.expires_at) < new Date()) {
    await queryOne(`UPDATE mp_qr_orders SET status = 'expired', updated_at = now() WHERE id = $1`, [id]);
    row.status = "expired";
  }

  return NextResponse.json(row);
}