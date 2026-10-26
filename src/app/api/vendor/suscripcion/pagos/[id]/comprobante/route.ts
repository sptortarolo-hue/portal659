import { getVendorByRequest } from "@/lib/vendor-utils";
import { query, queryOne } from "@/lib/db";
import { saveUploadedFile } from "@/lib/upload-file";
import { sendPushToUser } from "@/lib/push";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Sube el comprobante de un reclamo de pago de plan (imagen o PDF, máx 5MB).
 * POST /api/vendor/suscripcion/pagos/[id]/comprobante  (multipart: file)
 *
 * - Solo el dueño del reclamo (o sesión de preview del propio comercio).
 * - Idempotente: reemplaza el comprobante anterior si se sube otro.
 * - Avisa al dueño (push + campana) y deja el reclamo listo para que el
 *   admin lo revise en /admin/suscripciones.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const payment = await queryOne<{
    id: string;
    vendor_id: string;
    status: string;
    user_id: string | null;
  }>(
    `SELECT p.id, p.vendor_id, p.status, v.user_id
       FROM subscription_payments p JOIN vendors v ON v.id = p.vendor_id
      WHERE p.id = $1 LIMIT 1`,
    [id]
  ).catch(() => undefined);

  if (!payment || payment.vendor_id !== vendor.id) {
    return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  }
  if (payment.status !== "pending") {
    return NextResponse.json({ error: "Este pago ya fue revisado" }, { status: 409 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Adjuntá la foto o el PDF del comprobante" }, { status: 400 });
  }
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });

  try {
    const url = await saveUploadedFile({ file, folder: "comprobantes", vendorId: vendor.id });
    await query(
      `UPDATE subscription_payments
          SET comprobante_url = $1, comprobante_name = $2, comprobante_at = now()
        WHERE id = $3`,
      [url, (file.name || "comprobante").slice(0, 200), id]
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "No se pudo subir el comprobante" }, { status: 400 });
  }

  // Push/campana al dueño (el mail de aviso al admin lo manda el proceso de
  // revisión; acá solo confirmamos que quedó en cola).
  if (payment.user_id) {
    const title = "Comprobante recibido";
    const body = "Estamos revisando tu pago. Te avisamos cuando esté acreditado.";
    await query(
      `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'payment', '/vendor/suscripcion')`,
      [payment.user_id, title, body]
    ).catch(() => undefined);
    try {
      await sendPushToUser(payment.user_id, { title, body, link: "/vendor/suscripcion" });
    } catch {
      /* push best-effort */
    }
  }

  return NextResponse.json({ ok: true });
}
