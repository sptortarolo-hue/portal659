import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import {
  HANDOFF_TRANSITIONS,
  shipmentsReady,
  podColumnsReady,
  normalizeShipmentCode,
  loadShipmentForAdvance,
  validateDeliveryCertificate,
  applyAdvanceTx,
  syncAndNotify,
} from "@/lib/shipment-handoff";
import { formatShipmentCode, SHIPMENT_STATUS_LABELS, type ShipmentStatus } from "@/lib/shipping";

export const dynamic = "force-dynamic";

/**
 * Hoja de acción SIN login: el paquete es la llave. Quien tiene el paquete
 * escanea el QR de la oblea (/envio/CODE) y avanza la entrega — mismo patrón
 * de custodia por escaneo del rubro (cada handoff = scan + timestamp).
 * Solo transiciones con el paquete encima (Colectado → en adelante): el alta
 * y la cancelación siguen pidiendo sesión. Certificado de entrega idéntico al
 * operador (nombre + DNI + GPS). Rate limit por IP + código.
 */

export const POST = withRateLimit(
  async (request: Request, context?: { params: Promise<{ code: string }> }) => {
    const { code } = (context?.params ? await context.params : { code: "" }) as { code: string };
    const body = await request.json().catch(() => ({}));
    const refCode = normalizeShipmentCode(code);
    const status = String(body?.status ?? "").trim();
    const handoffText = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 250) : null;
    // Nombre del repartidor (registro de la logística en el evento, sin GPS).
    const courierName =
      typeof body?.courierName === "string" && body.courierName.trim().length >= 2
        ? body.courierName.trim().slice(0, 60)
        : "Repartidor Portal 659";
    const podPhotoUrl = typeof body?.podPhotoUrl === "string" && body.podPhotoUrl ? body.podPhotoUrl.trim() : null;

    if (!(await shipmentsReady())) {
      return NextResponse.json(
        { error: "Falta aplicar la migración de envíos (migrate-portal-shipments.sql)" },
        { status: 503 }
      );
    }
    if (!refCode) {
      return NextResponse.json({ error: "Falta el código del envío" }, { status: 400 });
    }
    if (!status || !(status in SHIPMENT_STATUS_LABELS)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    }

    // El envío por código (así viaja impreso en el QR).
    const current = await loadShipmentForAdvance({ code: refCode });
    if (!current) {
      return NextResponse.json({ error: "Encargo no encontrado" }, { status: 404 });
    }
    if (current.status === "requested") {
      return NextResponse.json(
        { error: "El comercio todavía no colectó el paquete con la logística" },
        { status: 409 }
      );
    }
    const allowed = HANDOFF_TRANSITIONS[current.status] || [];
    if (!allowed.includes(status as ShipmentStatus)) {
      return NextResponse.json(
        { error: `No podés pasar de '${current.status}' a '${status}'` },
        { status: 409 }
      );
    }

    // Certificado de entrega (idéntico a la exigencia del operador).
    const podEnforced = status === "delivered" && (await podColumnsReady());
    const cert = validateDeliveryCertificate(status, body, podEnforced);
    if (cert.error) {
      return NextResponse.json({ error: cert.error }, { status: 400 });
    }

    // Foto POD: URL que subió el repartidor por /api/shipment-upload/hand.
    let photoUrl: string | null = null;
    if (podPhotoUrl && podPhotoUrl.length <= 500 && podPhotoUrl.startsWith("http")) {
      photoUrl = podPhotoUrl;
    }

    try {
      await applyAdvanceTx({
        shipmentId: current.id,
        status,
        carrierId: null, // el carrier ya está asignado al colectar
        note: handoffText,
        photoUrl,
        operatorProfileId: null, // sin login: custodia por escaneo
        courierName,
        podEnforced,
        cert: cert.cert,
      });
    } catch (e) {
      return NextResponse.json(
        { error: `No se pudo actualizar el envío: ${e instanceof Error ? e.message : String(e)}` },
        { status: 500 }
      );
    }

    const sync = await syncAndNotify(current, status, handoffText);
    return NextResponse.json({
      ok: true,
      code: formatShipmentCode(refCode),
      status,
      statusLabel: SHIPMENT_STATUS_LABELS[status as ShipmentStatus] || status,
      orderSynced: sync.applied,
    });
  },
  { maxRequests: 30 }
);
