import { parsePhoneNumberFromString } from "libphonenumber-js/mobile";

/**
 * Validación de teléfonos argentinos aptos para WhatsApp (celulares).
 * Port desde app2/src/lib/phone.ts — usa libphonenumber-js/mobile para
 * asegurarse de que el número sea un celular (no un fijo) y normalizarlo a E.164.
 */

export const ARG_PHONE = /^549\d{10}$/;

export type PhoneCheck = {
  ok: boolean;
  partial: boolean;
  invalid: boolean;
  message: string;
  formatted: string;
  e164: string;
};

function digits(raw: string): string {
  const at = raw.indexOf("@");
  const slice = at >= 0 ? raw.slice(0, at) : raw;
  return slice.replace(/[^\d]/g, "");
}

/** Normaliza a E.164 (549XXXXXXXXXX, 13 dígitos) o devuelve null si no es un celular válido. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = digits(raw);
  if (!d) return null;
  if (ARG_PHONE.test(d)) return d;

  const rawClean = (raw.includes("@") ? raw.slice(0, raw.indexOf("@")) : raw).trim();
  const parsed = parsePhoneNumberFromString(rawClean, "AR");

  if (parsed) {
    const e164 = parsed.number ? digits(parsed.number) : "";
    if (ARG_PHONE.test(e164)) return e164;
  }

  let n = d.startsWith("00") ? d.slice(2) : d;
  if (n.startsWith("0")) n = n.slice(1);
  if (n.length === 10) n = "549" + n;
  if (!ARG_PHONE.test(n)) return null;
  return n;
}

/**
 * Chequea si un teléfono es un celular argentino válido (WhatsApp).
 * - ok: válido y móvil.
 * - partial: le faltan dígitos todavía (no es error).
 * - invalid: es un número pero no es un celular válido.
 */
export function checkArgPhone(raw: string): PhoneCheck {
  const d = digits(raw);
  if (!d) {
    return { ok: false, partial: true, invalid: false, message: "", formatted: "", e164: "" };
  }
  const e164 = toE164(raw);
  if (e164) {
    const p = parsePhoneNumberFromString("+" + e164);
    const isMobile = !!p && (p.getType() === "MOBILE" || !p.getType());
    if (isMobile) {
      return { ok: true, partial: false, invalid: false, message: "", formatted: p ? p.formatInternational() : e164, e164 };
    }
    return { ok: false, partial: false, invalid: true, message: "Solo se aceptan celulares (WhatsApp)", formatted: "", e164: "" };
  }
  if (d.length < 10) {
    return { ok: false, partial: true, invalid: false, message: "", formatted: "", e164: "" };
  }
  return { ok: false, partial: false, invalid: true, message: "Formato: 11 5555 1234 (celular)", formatted: "", e164: "" };
}

/** E.164 con el signo +, listo para guardarlo como identificador de WhatsApp. */
export function toE164Plus(raw: string | null | undefined): string | null {
  const e = toE164(raw);
  return e ? "+" + e : null;
}