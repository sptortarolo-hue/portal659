import { NextResponse } from "next/server";
import { getDeviceId } from "@/lib/device";
import { withRateLimit } from "@/lib/api-wrapper";
import {
  createOrder,
  DeliveryMethodError,
  InvalidPhoneError,
  OrderForbiddenError,
  OrderLimitError,
  StoreClosedError,
} from "@/lib/order-service";
import { OutOfStockError } from "@/lib/stock";
import { PricingError } from "@/lib/pricing";

export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json();
  const {
    vendorId,
    customerName,
    customerPhone,
    customerAddress,
    method,
    paymentMethod,
    customerId,
    items,
    notes,
    deliveryZoneId,
    deliveryOutOfArea,
  } = body;

  try {
    const result = await createOrder({
      vendorId,
      customerName,
      customerPhone,
      customerAddress,
      method,
      paymentMethod,
      customerId,
      items,
      notes,
      deviceId: getDeviceId(request),
      source: "web",
      deliveryZoneId: typeof deliveryZoneId === "string" ? deliveryZoneId : null,
      deliveryOutOfArea: deliveryOutOfArea === true,
    });

    return NextResponse.json({
      ok: true,
      orderId: result.orderId,
      total: result.total,
      cashDiscount: result.cashDiscount,
      cashPct: result.cashPct,
      volumeDiscount: result.volumeDiscount,
      volumeApplied: result.volumeApplied,
      trackToken: result.trackToken,
      deliveryFee: result.deliveryFee,
      deliveryZoneName: result.deliveryZoneName,
      deliveryOutOfArea: result.deliveryOutOfArea,
    });
  } catch (e) {
    if (e instanceof InvalidPhoneError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof OrderForbiddenError) {
      return NextResponse.json({ error: e.message }, { status: 403 });
    }
    if (e instanceof StoreClosedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof OrderLimitError) {
      return NextResponse.json({ error: e.message }, { status: 429 });
    }
    if (e instanceof DeliveryMethodError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof OutOfStockError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof PricingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof Error && e.message === "Faltan datos requeridos") {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}, { maxRequests: 10 });