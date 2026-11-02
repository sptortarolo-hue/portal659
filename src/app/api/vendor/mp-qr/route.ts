import { NextResponse } from "next/server";
import { queryOne, queryMany } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { getVendorMpToken, isMpEnabled } from "@/lib/mp-oauth";
import { getSiteUrl } from "@/lib/site-url";

// Genera un QR interoperable de Mercado Pago para cobrar una venta ya registrada.
// Body: { orderId, amount, concept? }
export async function POST(request: Request) {
  if (!isMpEnabled()) {
    return NextResponse.json({ error: "MP deshabilitado", code: "mp_disabled" }, { status: 403 });
  }

  const gate = await (async () => {
    try {
      return await getVendorByRequest(request);
    } catch {
      return null;
    }
  })();
  if (!gate?.vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  // getVendorByRequest solo trae id/user_id; necesitamos los campos mp_*.
  const vendor = await queryOne<any>(
    `SELECT * FROM vendors WHERE id = $1 LIMIT 1`,
    [gate.vendor.id]
  );
  if (!vendor) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const isPreview = (gate as any).previewSession === true;

  const body = await request.json().catch(() => ({}));
  const orderId = typeof body?.orderId === "string" ? body.orderId : null;
  const amount = Number(body?.amount);
  const concept = typeof body?.concept === "string" ? body.concept.slice(0, 120) : null;

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }

  // Verificar que la migración esté aplicada.
  let hasTable = false;
  try {
    const r = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mp_qr_orders') AS exists`
    );
    hasTable = r?.exists === true;
  } catch {
    hasTable = false;
  }
  if (!hasTable) {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-mp-qr.sql", code: "migration_missing" },
      { status: 503 }
    );
  }

  const externalReference = `portal659_mpqr_${vendor.id}_${Date.now()}`;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // En preview, simular (no requiere MP conectado).
  if (isPreview) {
    // Generar QR simulado con un link de prueba.
    const qrData = `https://www.portal659.com.ar/seguimiento/simulado?amount=${amount}`;
    let qrImage: string | null = null;
    try {
      const QRCode = (await import("qrcode")).default;
      qrImage = await QRCode.toDataURL(qrData, { width: 320, margin: 2 });
    } catch {
      qrImage = null;
    }
    const row = await queryOne<{ id: string }>(
      `INSERT INTO mp_qr_orders (vendor_id, order_id, amount, concept, external_reference, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [vendor.id, orderId, amount, concept, externalReference, expiresAt]
    );
    if (orderId && row?.id) {
      try {
        await queryOne(`UPDATE orders SET mp_qr_order_id = $1 WHERE id = $2 AND vendor_id = $3`, [row.id, orderId, vendor.id]);
      } catch { /* tolerante */ }
    }
    return NextResponse.json({ id: row?.id, qrData, qrImage, externalReference, expiresAt, amount, simulated: true });
  }

  const mpToken = await getVendorMpToken(vendor);
  if (!mpToken) {
    return NextResponse.json(
      { error: "El comercio todavía no conectó Mercado Pago", code: "vendor_not_connected" },
      { status: 409 }
    );
  }

  // API de QR de MP (genera QR interoperable EMVCo con monto).
  let qrData: string | null = null;
  let qrImage: string | null = null;
  let mpOrderId: string | null = null;
  const externalPosId = `portal659_${vendor.id}`;

  try {
    const qrRes = await fetch(
      `https://api.mercadopago.com/mpmobile/instore/qr/${vendor.mp_user_id}/${externalPosId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpToken}` },
        body: JSON.stringify({
          external_reference: externalReference,
          notification_url: `${getSiteUrl()}/api/webhooks/mercadopago`,
          items: [
            {
              title: concept || `Cobro ${vendor.store_name}`,
              unit_price: amount,
              quantity: 1,
              currency_id: "ARS",
            },
          ],
          total_amount: amount,
        }),
      }
    );
    const qrJson = await qrRes.json().catch(() => null);
    console.log("[mp-qr] mpmobile response:", JSON.stringify(qrJson)?.slice(0, 500), "status:", qrRes.status);
    if (qrJson?.qr_data) {
      qrData = qrJson.qr_data;
      mpOrderId = qrJson.in_store_order_id || null;
    } else if (qrJson?.qr_code) {
      qrData = qrJson.qr_code;
      mpOrderId = qrJson.in_store_order_id || null;
    }
  } catch (e) {
    console.warn("[mp-qr] mpmobile failed:", (e as any)?.message);
  }

  // Fallback: si la API mpmobile no devolvió qr_data, usar preferencia (QR con link).
  if (!qrData) {
    try {
      const prefRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpToken}` },
        body: JSON.stringify({
          items: [{ title: concept || `Cobro ${vendor.store_name}`, unit_price: amount, quantity: 1, currency_id: "ARS" }],
          metadata: { vendor_id: vendor.id, mpqr: "1" },
          external_reference: externalReference,
          back_urls: {
            success: `${getSiteUrl()}/vendor/dashboard`,
            failure: `${getSiteUrl()}/vendor/dashboard`,
            pending: `${getSiteUrl()}/vendor/dashboard`,
          },
          auto_return: "approved",
          notification_url: `${getSiteUrl()}/api/webhooks/mercadopago`,
        }),
      });
      const prefData = await prefRes.json();
      if (prefData?.init_point) {
        qrData = prefData.init_point;
      }
    } catch (e) {
      console.warn("[mp-qr] preference fallback failed:", (e as any)?.message);
    }
  }

  if (!qrData) {
    return NextResponse.json({ error: "No se pudo generar el QR" }, { status: 500 });
  }

  // Generar imagen QR server-side con la librería qrcode.
  try {
    const QRCode = (await import("qrcode")).default;
    qrImage = await QRCode.toDataURL(qrData, { width: 320, margin: 2 });
  } catch {
    qrImage = null;
  }

  // Persistir la orden.
  const row = await queryOne<{ id: string }>(
    `INSERT INTO mp_qr_orders (vendor_id, order_id, amount, concept, mp_order_id, external_reference, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [vendor.id, orderId, amount, concept, mpOrderId, externalReference, expiresAt]
  );

  // Vincular la orden al pedido si corresponde.
  if (orderId && row?.id) {
    try {
      await queryOne(
        `UPDATE orders SET mp_qr_order_id = $1 WHERE id = $2 AND vendor_id = $3`,
        [row.id, orderId, vendor.id]
      );
    } catch {
      /* columna sin migrar: ignorar */
    }
  }

  return NextResponse.json({
    id: row?.id,
    qrData,
    qrImage,
    externalReference,
    expiresAt,
    amount,
  });
}