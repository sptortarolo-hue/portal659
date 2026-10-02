/**
 * Config de envío del comercio desde la DB (solo servidor).
 * Tolerante a migración sin aplicar: si falta la tabla/columnas, devuelve
 * el default flat (comportamiento actual) en vez de romper el pedido.
 */
import { queryMany } from "@/lib/db";
import {
  normalizeDeliveryMode,
  type DeliveryMode,
  type DeliveryZoneInfo,
} from "@/lib/delivery";

export type VendorDeliveryConfig = {
  mode: DeliveryMode;
  baseFee: number | null;
  freeMin: number | null;
  areaText: string | null;
  zones: DeliveryZoneInfo[];
  /** Franjas de reparto propias (NULL = mismo horario del local). */
  deliveryHours: string | null;
  /** Base empaquetado+reparto retail en minutos. */
  deliveryPrepMin: number;
  hours: string | null;
  openOverride: boolean | null;
};

export async function fetchVendorDelivery(vendorId: string): Promise<VendorDeliveryConfig> {
  const fallback: VendorDeliveryConfig = {
    mode: "flat",
    baseFee: null,
    freeMin: null,
    areaText: null,
    zones: [],
    deliveryHours: null,
    deliveryPrepMin: 60,
    hours: null,
    openOverride: null,
  };
  try {
    // Tolerante a migración sin aplicar: si faltan las columnas nuevas se
    // reintenta sin ellas (mismo patrón que PATCH /api/vendor/me).
    let v: Record<string, unknown> | undefined;
    try {
      const rows = await queryMany<Record<string, unknown>>(
        `SELECT delivery_mode, delivery_fee, free_delivery_min, delivery_area_text,
                delivery_hours, delivery_prep_min, hours, open_override
         FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorId]
      );
      v = rows?.[0];
    } catch {
      const rows = await queryMany<Record<string, unknown>>(
        `SELECT delivery_mode, delivery_fee, free_delivery_min, delivery_area_text
         FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorId]
      );
      v = rows?.[0];
    }
    if (!v) return fallback;
    let zones: DeliveryZoneInfo[] = [];
    try {
      const zrows = await queryMany<Record<string, unknown>>(
        `SELECT id, name, description, fee FROM delivery_zones
         WHERE vendor_id = $1 AND active = true
         ORDER BY position ASC, created_at ASC`,
        [vendorId]
      );
      zones = (zrows || []).map((z) => ({
        id: String(z.id),
        name: String(z.name ?? ""),
        description: z.description != null ? String(z.description) : null,
        fee: Number(z.fee) || 0,
      }));
    } catch {
      zones = [];
    }
    return {
      mode: normalizeDeliveryMode(v.delivery_mode),
      baseFee: v.delivery_fee != null ? Number(v.delivery_fee) : null,
      freeMin: v.free_delivery_min != null ? Number(v.free_delivery_min) : null,
      areaText: v.delivery_area_text != null ? String(v.delivery_area_text) : null,
      zones,
      deliveryHours:
        "delivery_hours" in v && v.delivery_hours != null ? String(v.delivery_hours) : null,
      deliveryPrepMin:
        "delivery_prep_min" in v && v.delivery_prep_min != null
          ? Number(v.delivery_prep_min) || 60
          : 60,
      hours: "hours" in v && v.hours != null ? String(v.hours) : null,
      openOverride:
        "open_override" in v && v.open_override != null ? v.open_override === true : null,
    };
  } catch {
    return fallback;
  }
}
