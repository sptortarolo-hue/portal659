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

  // API de QR interoperable de MP (EMVCo): requiere store + POS en MP.
  // 1) Verificar si el vendor tiene store/pos persistidos (tolerante a migración).
  let hasStoreCol = false;
  let hasPosCol = false;
  try {
    const sc = await queryOne<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'mp_store_id') AS exists`);
    hasStoreCol = sc?.exists === true;
  } catch { hasStoreCol = false; }
  try {
    const pc = await queryOne<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'mp_external_pos_id') AS exists`);
    hasPosCol = pc?.exists === true;
  } catch { hasPosCol = false; }

  // Si las columnas no existen, crearlas on-the-fly (tolerante).
  if (!hasStoreCol) {
    try {
      await queryOne(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS mp_store_id text`);
      hasStoreCol = true;
    } catch { /* ignorar */ }
  }
  if (!hasPosCol) {
    try {
      await queryOne(`ALTER TABLE vendors ADD COLUMN IF NOT EXISTS mp_external_pos_id text`);
      hasPosCol = true;
    } catch { /* ignorar */ }
  }

  let storeId: string | null = (hasStoreCol ? vendor.mp_store_id : null) || null;
  let externalPosId: string | null = (hasPosCol ? vendor.mp_external_pos_id : null) || null;

  // 2) Si no hay store/pos, crearlos en MP.
  if (!storeId || !externalPosId) {
    externalPosId = `portal659_${vendor.id}`;
    try {
      // Crear store en MP.
      const storeRes = await fetch("https://api.mercadopago.com/users/" + vendor.mp_user_id + "/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpToken}` },
        body: JSON.stringify({
          name: vendor.store_name || "Portal 659",
          external_id: externalPosId,
          location: {
            street_name: vendor.address || "Calle",
            street_number: "1",
            city_name: "La Plata",
            state_code: "Buenos Aires",
            zip_code: "1900",
            country_name: "Argentina",
          },
        }),
      });
      const storeData = await storeRes.json().catch(() => null);
      console.log("[mp-qr] store response:", JSON.stringify(storeData)?.slice(0, 300), "status:", storeRes.status);
      if (storeData?.id) {
        storeId = String(storeData.id);
      }
    } catch (e) {
      console.warn("[mp-qr] store creation failed:", (e as any)?.message);
    }

    if (storeId) {
      try {
        // Crear POS en MP.
        const posRes = await fetch("https://api.mercadopago.com/pos", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpToken}` },
          body: JSON.stringify({
            name: "POS Portal 659",
            external_id: externalPosId,
            store_id: storeId,
            fixed_amount: false,
            category: 621102,
          }),
        });
        const posData = await posRes.json().catch(() => null);
        console.log("[mp-qr] pos response:", JSON.stringify(posData)?.slice(0, 300), "status:", posRes.status);
      } catch (e) {
        console.warn("[mp-qr] pos creation failed:", (e as any)?.message);
      }

      // Persistir store_id y external_pos_id.
      try {
        await queryOne(
          `UPDATE vendors SET mp_store_id = $1, mp_external_pos_id = $2 WHERE id = $3`,
          [storeId, externalPosId, vendor.id]
        );
      } catch { /* tolerante */ }
    }
  }

  // 3) Crear orden QR interoperable (EMVCo).
  let qrData: string | null = null;
  let qrImage: string | null = null;
  let mpOrderId: string | null = null;

  if (storeId && externalPosId) {
    try {
      const orderRes = await fetch(
        `https://api.mercadopago.com/instore/qr/seller/collectors/${vendor.mp_user_id}/stores/${storeId}/pos/${externalPosId}/orders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpToken}` },
          body: JSON.stringify({
            external_reference: externalReference,
            title: concept || `Cobro ${vendor.store_name}`,
            description: concept || `Cobro en ${vendor.store_name}`,
            notification_url: `${getSiteUrl()}/api/webhooks/mercadopago`,
            total_amount: amount,
            items: [
              {
                sku_number: "cobro",
                category: "services",
                title: concept || "Cobro",
                description: concept || "Cobro presencial",
                unit_price: amount,
                quantity: 1,
                unit_measure: "unit",
                total_amount: amount,
              },
            ],
          }),
        }
      );
      const orderData = await orderRes.json().catch(() => null);
      console.log("[mp-qr] instore order response:", JSON.stringify(orderData)?.slice(0, 500), "status:", orderRes.status);
      if (orderData?.qr_data) {
        qrData = orderData.qr_data;
        mpOrderId = orderData.in_store_order_id || null;
      }
    } catch (e) {
      console.warn("[mp-qr] instore order failed:", (e as any)?.message);
    }
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