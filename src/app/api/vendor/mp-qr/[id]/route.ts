import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await (async () => {
    try {
      const { vendor } = await getVendorByRequest(request);
      return vendor;
    } catch {
      return null;
    }
  })();
  if (!gate) {
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
    [id, (gate as any).id]
  );

  if (!row) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }

  // Expirar si pasó el tiempo.
  if (row.status === "pending" && row.expires_at && new Date(row.expires_at) < new Date()) {
    await queryOne(`UPDATE mp_qr_orders SET status = 'expired', updated_at = now() WHERE id = $1`, [id]);
    row.status = "expired";
  }

  return NextResponse.json(row);
}