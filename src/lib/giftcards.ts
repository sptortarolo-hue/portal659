import { randomBytes } from "crypto";

/**
 * Giftcards compartidas (estética, comercio, moda). Sin gate de plan
 * (igual que estética hoy): solo importan vertical + MP conectado.
 * Tablas agnósticas al vertical (vendor_id); solo cambia el prefijo.
 */

export const GIFT_VERTICALS = ["estetica", "comercio", "moda"] as const;

export function canSellGiftcards(vertical: string | null | undefined): boolean {
  return !!vertical && (GIFT_VERTICALS as readonly string[]).includes(vertical);
}

export function giftCodePrefix(vertical: string | null | undefined): string {
  if (vertical === "comercio") return "COM";
  if (vertical === "moda") return "MOD";
  return "EST";
}

export function newGiftCode(vertical: string | null | undefined): string {
  return `${giftCodePrefix(vertical)}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Monto válido: >0 y con 2 decimales como máximo (pesos). */
export function normalizeGiftAmount(raw: unknown): number | null {
  const n = Math.round(Number(raw) || 0);
  return n > 0 ? n : null;
}
