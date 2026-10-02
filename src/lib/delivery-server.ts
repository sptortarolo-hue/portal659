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
import type { DeliveryExtraDay } from "@/lib/delivery-schedule";

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
  /** Override de reparto (NULL=horario, true=forzar abierto, false=pausado). */
  deliveryOverride: boolean | null;
  /** Auto-resume de la pausa (ISO o NULL). */
  deliveryPausedUntil: string | null;
  deliveryPauseReason: string | null;
  /** Días especiales {"YYYY-MM-DD": {open?, close?}}. */
  deliveryExtraDays: Record<string, DeliveryExtraDay> | null;
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
    deliveryOverride: null,
    deliveryPausedUntil: null,
    deliveryPauseReason: null,
    deliveryExtraDays: null,
  };
  try {
    // Tolerante a migraciones sin aplicar: se reintenta sacando columnas
    // nuevas por capas (override → franjas → mínimo). Mismo patrón que
    // PATCH /api/vendor/me.
    const SELECTS = [
      `SELECT delivery_mode, delivery_fee, free_delivery_min, delivery_area_text,
              delivery_hours, delivery_prep_min, hours, open_override,
              delivery_override, delivery_paused_until, delivery_pause_reason,
              delivery_extra_days
       FROM vendors WHERE id = $1 LIMIT 1`,
      `SELECT delivery_mode, delivery_fee, free_delivery_min, delivery_area_text,
              delivery_hours, delivery_prep_min, hours, open_override
       FROM vendors WHERE id = $1 LIMIT 1`,
      `SELECT delivery_mode, delivery_fee, free_delivery_min, delivery_area_text
       FROM vendors WHERE id = $1 LIMIT 1`,
    ];
    let v: Record<string, unknown> | undefined;
    for (const sql of SELECTS) {
      try {
        const rows = await queryMany<Record<string, unknown>>(sql, [vendorId]);
        v = rows?.[0];
        break;
      } catch {
        v = undefined;
      }
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
      deliveryOverride:
        "delivery_override" in v && v.delivery_override != null
          ? v.delivery_override === true
          : null,
      deliveryPausedUntil:
        "delivery_paused_until" in v && v.delivery_paused_until != null
          ? String(v.delivery_paused_until)
          : null,
      deliveryPauseReason:
        "delivery_pause_reason" in v && v.delivery_pause_reason != null
          ? String(v.delivery_pause_reason)
          : null,
      deliveryExtraDays:
        "delivery_extra_days" in v && v.delivery_extra_days != null &&
        typeof v.delivery_extra_days === "object"
          ? (v.delivery_extra_days as Record<string, DeliveryExtraDay>)
          : null,
    };
  } catch {
    return fallback;
  }
}
