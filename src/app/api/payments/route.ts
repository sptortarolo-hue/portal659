import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { getVendorMpToken, isMpEnabled, type VendorMpRow } from "@/lib/mp-oauth";
import { NextResponse } from "next/server";

// Mercado Pago Preference API (multi-market: cada comercio cobra con SU cuenta)
// Docs: https://www.mercadopago.com.ar/developers/en/docs/checkout-pro/landing

export async function POST(request: Request) {
  // Llave maestra: sin OK de MP no se cobra online por ningún canal.
  if (!isMpEnabled()) {
    return NextResponse.json(
      { error: "Los pagos online están deshabilitados por ahora", code: "mp_disabled" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { vendorId, items, total, customerName, customerPhone, customerAddress, method, isPreview, deliveryZoneId, deliveryOutOfArea, deliveryWindow, shippingZoneId } = body;

  // En modo prueba nunca se cobra online con dinero real.
  if (isPreview) {
    return NextResponse.json(
      { error: "Los pagos online están deshabilitados en modo prueba." },
      { status: 400 }
    );
  }

  // Link de cobro de fiado: { vendorId, debtPhone, debtAmount }.
  // Preferencia de ítem único; el webhook registra el pago en cuenta
  // corriente (NO crea pedido).
  if (typeof body?.debtPhone === "string" && body?.debtAmount != null) {
    return debtPreference(body, request);
  }

  // Cobro de pedido post-peso (pesables, modo "confirmar"): { vendorId, orderId }
  // (desde el panel) o { orderId, trackToken } (desde el seguimiento público).
  // El pedido ya existe (nació pendiente de peso) y el comercio ya confirmó
  // el total real: acá solo generamos la preferencia por ese monto.
  if (body?.orderId && (body?.vendorId || body?.trackToken)) {
    return orderWeightPreference(body, request);
  }

  if (!vendorId || !items || !total) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const vendor = await queryOne<
    { store_name: string; slug: string } & VendorMpRow
  >(
    `SELECT id, store_name, slug, mp_user_id, mp_access_token, mp_refresh_token, mp_public_key, mp_expires_at, mp_connected_at
     FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  if (!vendor) {
    return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  }

  // Cobros online siempre con la cuenta del COMERCIO (multi-tenant).
  // Si no está conectado, no hay pago online (la torta no la come el portal).
  const mpToken = await getVendorMpToken(vendor);
  if (!mpToken) {
    return NextResponse.json(
      { error: "El comercio todavía no conectó Mercado Pago", code: "vendor_not_connected" },
      { status: 409 }
    );
  }

  // Sanidad: MP acepta la preferencia aunque algún ítem venga con precio
  // 0 o qty <= 0, pero después el checkout no puede armar medios de pago y el
  // cliente cae en "Elegí cómo pagar" sin opciones. Lo cortamos acá.
  const invalidItem = items.find(
    (i: any) => !(Number(i.price) > 0) || !(Number(i.qty) > 0) || !Number.isFinite(Number(i.price))
  );
  if (invalidItem) {
    console.warn(
      `[MP preference] rejected vendor=${vendorId} item sin precio válido price=${invalidItem?.price} qty=${invalidItem?.qty}`
    );
    return NextResponse.json(
      { error: `Hay un ítem sin precio válido en el carrito ("${invalidItem?.name || "?"}"). Sacalo y volvé a intentar.` },
      { status: 400 }
    );
  }

  try {
    const preference = {
      items: items.map((i: any) => ({
        title: i.name,
        unit_price: i.price,
        quantity: i.qty,
        currency_id: "ARS",
      })),
      payer: {
        name: customerName,
        // Sin phone: MP es estricto con el formato (area_code/number separados)
        // y un formato raro puede hacer la preferencia rebotar al home de MP
        // en vez de abrir el checkout. El teléfono del cliente igual queda en
        // metadata.customer_phone (es donde lo lee el webhook para el pedido).
      },
      metadata: {
        vendor_id: vendorId,
        customer_name: customerName || "",
        customer_phone: customerPhone,
        customer_address: customerAddress || "",
        delivery_method: method || "delivery",
        // Zona de envío (el webhook la valida contra el comercio y la persiste).
        delivery_zone_id: typeof deliveryZoneId === "string" ? deliveryZoneId : "",
        delivery_out_of_area: deliveryOutOfArea === true ? "1" : "",
        // Zona extendida del catálogo (Portal 659 Envíos): el webhook la
        // valida contra el comercio (y la persiste como shipping_zone_id).
        shipping_zone_id: typeof shippingZoneId === "string" ? shippingZoneId : "",
        // Turno de entrega retail (el webhook lo valida y persiste).
        delivery_window: typeof deliveryWindow === "string" ? deliveryWindow.slice(0, 60) : "",
        // JSON string: referencias para descontar stock al aprobarse el pago.
        // Con combo por unidad cada entrada lleva sus piezas (combo_members):
        // el webhook las descuenta por variante y las persiste en el pedido.
        stock_items: JSON.stringify(
          items.map((i: any) => ({
            variant_id: typeof i.variantId === "string" ? i.variantId : null,
            product_id: typeof i.offerId === "string" ? i.offerId : null,
            qty: Number(i.qty) || 1,
            name: i.name,
            unit: i.unit === "kg" ? "kg" : undefined,
            combo_members: Array.isArray(i.combo_members) && i.combo_members.length > 0 ? i.combo_members : undefined,
          }))
        ),
      },
      external_reference: `portal659_${vendorId}_${Date.now()}`,
      back_urls: {
        success: `${getSiteUrl()}/checkout?payment=success&vendor=${vendor.slug || vendorId}`,
        failure: `${getSiteUrl()}/checkout?payment=failure&vendor=${vendor.slug || vendorId}`,
        pending: `${getSiteUrl()}/checkout?payment=pending&vendor=${vendor.slug || vendorId}`,
      },
      auto_return: "approved",
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago`,
    };

    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
      },
      body: JSON.stringify(preference),
    });

    const data = await res.json();

    if (data.id) {
      // init_point (producción) vs sandbox_init_point: depende del TOKEN del
      // comercio, no del cliente. Un token TEST- tiene que abrir el sandbox;
      // si abrimos init_point con token de prueba, MP manda al home/login en
      // vez de al checkout (el "te lleva a MP pero no al lugar para pagar").
      const isTest = mpToken.startsWith("TEST-");
      const initPoint = isTest && data.sandbox_init_point ? data.sandbox_init_point : data.init_point;
      const initKind = isTest
        ? data.sandbox_init_point
          ? "sandbox"
          : "prod-fallback"
        : data.init_point
          ? "prod"
          : "MISSING";
      const itemsSum = items.reduce((s: number, i: any) => s + Number(i.price) * Number(i.qty), 0);
      console.log(
        `[MP preference] ok id=${data.id} vendor=${vendorId} sandbox=${isTest} init=${initKind} items=${items.length} itemsSum=${Math.round(itemsSum)} total=${total} method=${method || "?"}` +
          ` prices=[${items.map((i: any) => Number(i.price)).join(",")}]`
      );
      return NextResponse.json({
        preferenceId: data.id,
        initPoint,
        sandbox: isTest,
      });
    }

    // Sin data.id: algo del contenido de la preferencia no le gusta a MP.
    // Logueamos el mensaje en docker logs para diagnosticar de un vistazo
    // (sin tokens ni datos sensibles).
    console.warn(
      `[MP preference] FAIL status=${res.status} vendor=${vendorId} message=${data.message || data.error || "sin detalle"}`
    );
    return NextResponse.json({ error: data.message || "Error al crear preferencia" }, { status: 500 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error de conexión con Mercado Pago" }, { status: 500 });
  }
}

/**
 * Link de cobro de fiado: genera una preferencia de ítem único
 * ("Saldo cuenta corriente") con metadata debt_phone. El webhook, al
 * aprobarse, registra el pago en cuenta corriente (NO crea pedido).
 * Requiere plan con pos/crm (mismo alcance que el fiado en mostrador).
 */
async function debtPreference(body: any, request: Request) {
  const { toE164 } = await import("@/lib/phone");
  const { getVendorByRequest } = await import("@/lib/vendor-utils");
  const vendorId = String(body?.vendorId || "");
  // Solo el dueño/admin del comercio genera links de cobro.
  try {
    const { vendor: caller } = await getVendorByRequest(request);
    if (!caller || caller.id !== vendorId) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const phone = toE164(String(body?.debtPhone || ""));
  const amount = Math.round(Number(body?.debtAmount) * 100) / 100;
  if (!vendorId || !phone || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Faltan datos (comercio, teléfono y monto)" }, { status: 400 });
  }
  const vendor = await queryOne<
    { store_name: string; slug: string } & VendorMpRow
  >(
    `SELECT id, store_name, slug, mp_user_id, mp_access_token, mp_refresh_token, mp_public_key, mp_expires_at, mp_connected_at
     FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );
  if (!vendor) {
    return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  }
  const mpToken = await getVendorMpToken(vendor);
  if (!mpToken) {
    return NextResponse.json(
      { error: "El comercio todavía no conectó Mercado Pago", code: "vendor_not_connected" },
      { status: 409 }
    );
  }
  try {
    const preference = {
      items: [
        {
          title: `Saldo cuenta corriente — ${vendor.store_name}`,
          unit_price: amount,
          quantity: 1,
          currency_id: "ARS",
        },
      ],
      metadata: {
        vendor_id: vendorId,
        debt_phone: phone,
        customer_phone: phone,
      },
      external_reference: `portal659_fiado_${vendorId}_${phone.replace(/\D/g, "")}_${Date.now()}`,
      back_urls: {
        success: `${getSiteUrl()}/tienda/${vendor.slug || vendorId}`,
        failure: `${getSiteUrl()}/tienda/${vendor.slug || vendorId}`,
        pending: `${getSiteUrl()}/tienda/${vendor.slug || vendorId}`,
      },
      auto_return: "approved",
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago`,
    };
    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
      },
      body: JSON.stringify(preference),
    });
    const data = await res.json();
    if (data.id) {
      const isTest = mpToken.startsWith("TEST-");
      const initPoint = isTest && data.sandbox_init_point ? data.sandbox_init_point : data.init_point;
      return NextResponse.json({ preferenceId: data.id, initPoint, sandbox: isTest });
    }
    console.warn(`[MP preference] FAIL debt vendor=${vendorId} message=${data.message || data.error || "sin detalle"}`);
    return NextResponse.json({ error: data.message || "Error al crear preferencia" }, { status: 500 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error de conexión con Mercado Pago" }, { status: 500 });
  }
}

/**
 * Link de cobro de pedido post-peso (pesables, modo "confirmar").
 * Genera una preferencia por el total REAL del pedido (ya pesado y confirmado
 * por el comercio). El webhook (rama portal659_order_) marca el pedido pagado.
 * Dos vías:
 *  - Panel: { vendorId, orderId } — requiere sesión del comercio.
 *  - Seguimiento público: { orderId, trackToken } — el cliente toca "Pagar".
 *    Con diferencia > tolerancia exige weight_approved_at (aceptó el total).
 */
async function orderWeightPreference(body: any, request: Request) {
  const vendorId = typeof body?.vendorId === "string" ? body.vendorId : "";
  const orderId = String(body?.orderId || "");
  const trackToken = typeof body?.trackToken === "string" ? body.trackToken : "";

  if (!orderId || (!vendorId && !trackToken)) {
    return NextResponse.json({ error: "Faltan datos (pedido)" }, { status: 400 });
  }

  // Vía pública (seguimiento): el token del pedido autoriza.
  if (!vendorId && trackToken) {
    const match = await queryOne<{ id: string }>(
      `SELECT id FROM orders WHERE id = $1 AND track_token = $2 LIMIT 1`,
      [orderId, trackToken]
    );
    if (!match) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  } else {
    // Vía panel: solo el dueño/admin del comercio genera links de cobro.
    try {
      const { getVendorByRequest } = await import("@/lib/vendor-utils");
      const { vendor: caller } = await getVendorByRequest(request);
      if (!caller || caller.id !== vendorId) {
        return NextResponse.json({ error: "No autorizado" }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  const order = await queryOne<{
    id: string;
    vendor_id: string;
    store_name: string;
    slug: string | null;
    total: number | null;
    pickup_number: number | null;
    status: string;
    payment_status: string;
    payment_method: string;
    track_token: string | null;
    weight_confirmed_at: string | null;
    weight_approved_at: string | null;
    weight_estimated_total: number | null;
  }>(
    `SELECT o.id, o.vendor_id, o.total, o.pickup_number, o.status, o.payment_status, o.payment_method, o.track_token,
            v.store_name, v.slug,
            CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_confirmed_at')
              THEN o.weight_confirmed_at ELSE NULL END AS weight_confirmed_at,
            CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_approved_at')
              THEN o.weight_approved_at ELSE NULL END AS weight_approved_at,
            CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_estimated_total')
              THEN o.weight_estimated_total ELSE NULL END AS weight_estimated_total
     FROM orders o JOIN vendors v ON v.id = o.vendor_id
     WHERE o.id = $1 LIMIT 1`,
    [orderId]
  );

  if (!order || order.vendor_id !== (vendorId || order.vendor_id)) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  // Tolerancia: si el total real difiere del estimado más allá del % pactado,
  // el cliente tiene que haber tocado "Aceptar total" en el seguimiento.
  let tolerancePct = 20;
  try {
    const vcfg = await queryOne<{ weight_tolerance_pct: number | null }>(
      `SELECT weight_tolerance_pct FROM vendors WHERE id = $1 LIMIT 1`,
      [order.vendor_id]
    );
    if (Number.isFinite(Number(vcfg?.weight_tolerance_pct)) && Number(vcfg?.weight_tolerance_pct) > 0) {
      tolerancePct = Math.min(100, Math.floor(Number(vcfg?.weight_tolerance_pct)));
    }
  } catch { /* default 20 */ }

  if (order.status === "cancelled") {
    return NextResponse.json({ error: "El pedido fue cancelado" }, { status: 400 });
  }
  if (order.payment_status !== "pending") {
    return NextResponse.json({ error: "Este pedido ya no está pendiente de pago" }, { status: 400 });
  }
  if (order.payment_method !== "mercadopago") {
    return NextResponse.json({ error: "Este pedido no se cobra online" }, { status: 400 });
  }
  if (!order.weight_confirmed_at) {
    return NextResponse.json({ error: "El comercio todavía no confirmó el peso de tu pedido" }, { status: 409 });
  }
  if (trackToken && !vendorId) {
    const est = Number(order.weight_estimated_total) || 0;
    const real = Number(order.total) || 0;
    const diffExceeds = est > 0 && Math.abs(real - est) / est > tolerancePct / 100;
    if (diffExceeds && !order.weight_approved_at) {
      return NextResponse.json(
        { error: "Primero aceptá el total actualizado", code: "approval_required" },
        { status: 409 }
      );
    }
  }

  const vendor = await queryOne<
    { store_name: string; slug: string } & VendorMpRow
  >(
    `SELECT id, store_name, slug, mp_user_id, mp_access_token, mp_refresh_token, mp_public_key, mp_expires_at, mp_connected_at
     FROM vendors WHERE id = $1 LIMIT 1`,
    [order.vendor_id]
  );
  if (!vendor) {
    return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  }
  const mpToken = await getVendorMpToken(vendor);
  if (!mpToken) {
    return NextResponse.json(
      { error: "El comercio todavía no conectó Mercado Pago", code: "vendor_not_connected" },
      { status: 409 }
    );
  }

  const amount = Math.round(Number(order.total) * 100) / 100;
  if (!(amount > 0)) {
    return NextResponse.json({ error: "El total del pedido no es válido" }, { status: 400 });
  }
  const track = order.track_token || trackToken;
  const backBase = `${getSiteUrl()}${track ? `/seguimiento/${track}` : "/mis-pedidos"}`;

  try {
    const preference = {
      items: [
        {
          title: `Pedido ${order.pickup_number != null ? `Nro. ${order.pickup_number}` : `#${order.id.slice(0, 8)}`} — ${vendor.store_name}`,
          unit_price: amount,
          quantity: 1,
          currency_id: "ARS",
        },
      ],
      metadata: {
        vendor_id: order.vendor_id,
        order_id: order.id,
        customer_name: "",
        customer_phone: "",
      },
      external_reference: `portal659_order_${order.id}_${Date.now()}`,
      back_urls: {
        success: `${backBase}?paid=1`,
        failure: backBase,
        pending: backBase,
      },
      auto_return: "approved",
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago`,
    };
    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mpToken}`,
      },
      body: JSON.stringify(preference),
    });
    const data = await res.json();
    if (data.id) {
      const isTest = mpToken.startsWith("TEST-");
      const initPoint = isTest && data.sandbox_init_point ? data.sandbox_init_point : data.init_point;
      console.log(`[MP preference] ok order-weight id=${data.id} vendor=${order.vendor_id} order=${order.id} total=${amount}`);
      return NextResponse.json({ preferenceId: data.id, initPoint, sandbox: isTest });
    }
    console.warn(`[MP preference] FAIL order-weight vendor=${order.vendor_id} message=${data.message || data.error || "sin detalle"}`);
    return NextResponse.json({ error: data.message || "Error al crear preferencia" }, { status: 500 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Error de conexión con Mercado Pago" }, { status: 500 });
  }
}

// El checkout le pregunta "¿puedo cobrar online?" + config de pago por comercio.
export async function GET(request: Request) {
  const vendorId = new URL(request.url).searchParams.get("vendorId");
  if (!vendorId) {
    return NextResponse.json({ configured: false, reason: "vendorId requerido" }, { status: 400 });
  }

  // Toggle "¿Con cuánto abonás?" (efectivo + delivery): se informa siempre,
  // independiente de si MP está habilitado.
  let cashAskAmount = true;
  try {
    const v = await queryOne<{ cash_ask_amount: boolean | null }>(
      `SELECT cash_ask_amount FROM vendors WHERE id = $1 LIMIT 1`,
      [vendorId]
    );
    cashAskAmount = v?.cash_ask_amount !== false;
  } catch {
    /* migración sin aplicar: default activado */
  }

  // Modo de cobro de pesables (migrate-weight-confirm.sql, tolerante): con
  // "confirmar" + carrito con kg, el checkout difiere el pago MP hasta que el
  // comercio pesa (el botón MP crea el pedido y el cobro sale del seguimiento).
  let weightConfirmMode = "estimado";
  try {
    const v = await queryOne<{ weight_confirm_mode: string | null }>(
      `SELECT weight_confirm_mode FROM vendors WHERE id = $1 LIMIT 1`,
      [vendorId]
    );
    if (v?.weight_confirm_mode === "confirmar") weightConfirmMode = "confirmar";
  } catch {
    /* migración sin aplicar: modo estimado */
  }

  // Sin OK de MP el checkout nunca ofrece pago online.
  if (!isMpEnabled()) {
    return NextResponse.json({ configured: false, reason: "mp_disabled", cashAskAmount, weightConfirmMode });
  }

  const vendor = await queryOne<{ mp_user_id: number | null }>(
    `SELECT mp_user_id FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  return NextResponse.json({
    configured: !!vendor?.mp_user_id,
    publicKey: null,
    cashAskAmount,
    weightConfirmMode,
  });
}
