/**
 * Tipos y constantes client-safe del cobro de la logística al local.
 * NO importa pg ni db — puede usarse en componentes client.
 */

/** Métodos de cobro (mismos que el panel del comercio, más "fiado"). */
export const SHIPMENT_PAYMENT_METHODS = [
  { key: "efectivo", label: "💵 Efectivo" },
  { key: "transferencia", label: "🏦 Transferencia" },
  { key: "tarjeta", label: "💳 Tarjeta" },
  { key: "mixto", label: "🪙 Mixto" },
  { key: "fiado", label: "📓 Fiado (deuda)" },
] as const;

export type ShipmentPaymentMethod =
  (typeof SHIPMENT_PAYMENT_METHODS)[number]["key"];
