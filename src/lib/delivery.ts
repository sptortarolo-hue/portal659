/**
 * Envío por zona del comercio (client-safe: sin imports de servidor).
 *
 * Sin mapas ni geocoding: la zona la autodeclara el cliente (canal web) o la
 * elige el comerciante (mostrador). Este resolver es la ÚNICA regla de fee y
 * lo usan el checkout (espejo visual), `resolveOrderPricing` (canal web),
 * `pos/order` y la conversión pickup→delivery (mostrador).
 *
 * Perfiles por comercio (`vendors.delivery_mode`):
 *  - flat (default): tarifa única `delivery_fee` + pregunta dentro/fuera.
 *  - zones: hasta 3 zonas (nombre + descripción barrial + fee).
 * `free_delivery_min` (global) deja el envío en $0 en ambos modos, salvo
 * "otra zona" (el costo lo cotiza el comercio por WhatsApp: el sistema no
 * puede regalar lo que no conoce).
 */

export type DeliveryMode = "flat" | "zones";

export type DeliveryZoneInfo = {
  id: string;
  name: string;
  description: string | null;
  fee: number;
};

export type DeliverySelection =
  | { kind: "pickup" }
  /** Modo flat: dentro del área habitual. */
  | { kind: "in_area" }
  /** Modo zones: zona elegida por id. */
  | { kind: "zone"; zoneId: string }
  /**
   * Fuera del área ("otra zona"): entra a convenir. En web el fee
   * provisorio es el base; en mostrador el comerciante (autoridad)
   * puede fijar un monto manual.
   */
  | { kind: "out_of_area"; manualFee?: number | null };

export type ResolvedDelivery = {
  /** Fee a cobrar (0 si gratis/retiro). */
  fee: number;
  zoneId: string | null;
  zoneName: string | null;
  outOfArea: boolean;
  /** true = se ganó envío gratis por monto. */
  freeShipping: boolean;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function normalizeDeliveryMode(v: unknown): DeliveryMode {
  return v === "zones" ? "zones" : "flat";
}

export function resolveDeliveryFee(opts: {
  mode: DeliveryMode;
  /** Tarifa única (flat) / provisorio fuera de zona (zones). */
  baseFee?: number | null;
  /** Gratis desde $X (global). NULL/0 = sin promo. */
  freeMin?: number | null;
  /** Zonas activas del comercio (modo zones). */
  zones?: DeliveryZoneInfo[];
  selection: DeliverySelection;
  /** Subtotal neto (post-volumen, pre-cash): es lo que cuenta para gratis-desde. */
  netSubtotal?: number | null;
  /**
   * Permite monto manual en out_of_area. Solo rutas autenticadas como
   * vendor (mostrador): el canal web NUNCA lo usa (el cliente no fija precios).
   */
  allowManual?: boolean;
}): ResolvedDelivery {
  const { mode, zones } = opts;
  const base = num(opts.baseFee);
  const freeMin = num(opts.freeMin);
  const net = Number(opts.netSubtotal) || 0;
  const sel = opts.selection;

  if (sel.kind === "pickup") {
    return { fee: 0, zoneId: null, zoneName: null, outOfArea: false, freeShipping: false };
  }

  // Fuera del área: entra a convenir. Nunca aplica gratis-desde (el costo
  // real lo cotiza el comercio por WhatsApp).
  if (sel.kind === "out_of_area") {
    const manual = opts.allowManual === true ? num(sel.manualFee) : 0;
    return {
      fee: manual > 0 ? Math.round(manual * 100) / 100 : base,
      zoneId: null,
      zoneName: null,
      outOfArea: true,
      freeShipping: false,
    };
  }

  let fee = base;
  let zoneId: string | null = null;
  let zoneName: string | null = null;

  if (mode === "zones" && sel.kind === "zone") {
    const z = (zones || []).find((zz) => String(zz.id) === String(sel.zoneId));
    if (z) {
      fee = num(z.fee);
      zoneId = String(z.id);
      zoneName = z.name;
    } else {
      // Zona inexistente/inactiva (request directo o zona borrada): no se
      // rechaza el pedido — cae a fuera de zona con provisorio base.
      return {
        fee: base,
        zoneId: null,
        zoneName: null,
        outOfArea: true,
        freeShipping: false,
      };
    }
  }

  if (freeMin > 0 && net >= freeMin) {
    return { fee: 0, zoneId, zoneName, outOfArea: false, freeShipping: true };
  }

  return {
    fee: Math.round(fee * 100) / 100,
    zoneId,
    zoneName,
    outOfArea: false,
    freeShipping: false,
  };
}

/** Etiqueta corta del envío para tickets/WhatsApp/detalle. */
export function deliveryLabel(r: Pick<ResolvedDelivery, "fee" | "zoneName" | "outOfArea" | "freeShipping">): string {
  if (r.outOfArea) return "A convenir";
  if (r.freeShipping) return "¡Gratis!";
  if (r.zoneName) return `${r.zoneName}: $${r.fee.toLocaleString("es-AR")}`;
  return `$${r.fee.toLocaleString("es-AR")}`;
}
