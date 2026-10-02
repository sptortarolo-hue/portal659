import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

// Caja barrial amplia (La Plata y alrededores): descarta fixes de GPS locos
// sin impedir repartos reales. No es geofence de negocio, solo sanidad.
const MIN_LAT = -35.2;
const MAX_LAT = -34.7;
const MIN_LNG = -58.2;
const MAX_LNG = -57.5;

// Throttle server: el celu reporta cada ~15s; si llega antes se acepta
// (200) pero sin escribir (ahorra writes del pool).
const MIN_INTERVAL_MS = 10_000;

/**
 * POST /api/vendor/orders/[id]/position { lat, lng, accuracy? }
 * El repartidor reporta su posición en vivo. Solo vale mientras el pedido
 * está en `sent` (En camino) y es delivery. Al entregar/cancelar el PATCH
 * nulifica las columnas (corte de privacidad).
 */
export const POST = withRateLimit(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const params = await context.params;
    const { vendor, userId, staffRole } = await getVendorByRequest(request);
    if (!vendor) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    let body: { lat?: unknown; lng?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json({ error: "Coordenadas inválidas" }, { status: 400 });
    }
    if (lat < MIN_LAT || lat > MAX_LAT || lng < MIN_LNG || lng > MAX_LNG) {
      return NextResponse.json({ error: "Ubicación fuera del área de reparto" }, { status: 400 });
    }

    const order = await queryOne<{
      id: string;
      vendor_id: string;
      method: string;
      status: string;
      assigned_to: string | null;
      courier_updated_at: string | null;
    }>(
      `SELECT id, vendor_id, method, status, assigned_to,
        CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'courier_updated_at')
          THEN courier_updated_at ELSE NULL END AS courier_updated_at
        FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [params.id, vendor.id]
    );
    if (!order) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }
    if (order.method !== "delivery" || order.status !== "sent") {
      return NextResponse.json(
        { error: "Solo se puede compartir ubicación en un envío En camino" },
        { status: 409 }
      );
    }
    // El repartidor solo reporta sus propias entregas; el dueño (o sesión de
    // prueba/admin) puede reportar cualquiera (ej: prueba del circuito).
    if (staffRole === "delivery" && order.assigned_to !== userId) {
      return NextResponse.json({ error: "Ese pedido no está asignado a vos" }, { status: 403 });
    }

    if (order.courier_updated_at) {
      const age = Date.now() - new Date(order.courier_updated_at).getTime();
      if (age < MIN_INTERVAL_MS) {
        return NextResponse.json({ ok: true, throttled: true });
      }
    }

    try {
      await queryOne(
        `UPDATE orders SET courier_lat = $1, courier_lng = $2, courier_updated_at = NOW()
          WHERE id = $3 AND vendor_id = $4`,
        [lat, lng, params.id, vendor.id]
      );
    } catch {
      // Migración migrate-delivery-live.sql sin aplicar: no romper el flujo.
      return NextResponse.json(
        { error: "Ubicación en vivo no disponible (falta migración)" },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: true });
  },
  { maxRequests: 120 }
);
