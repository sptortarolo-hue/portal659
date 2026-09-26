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
};

export async function fetchVendorDelivery(vendorId: string): Promise<VendorDeliveryConfig> {
  const fallback: VendorDeliveryConfig = {
    mode: "flat",
    baseFee: null,
    freeMin: null,
    areaText: null,
    zones: [],
  };
  try {
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT delivery_mode, delivery_fee, free_delivery_min, delivery_area_text
       FROM vendors WHERE id = $1 LIMIT 1`,
      [vendorId]
    );
    const v = rows?.[0];
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
    };
  } catch {
    return fallback;
  }
}
