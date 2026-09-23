/**
 * Cifrado de secretos fiscales (certificado/clave ARCA) en reposo.
 * Mismo formato AES-256-GCM que mp-oauth (`iv.tag.data` en base64).
 * Clave: `FISCAL_KEY`, con fallback a `MP_TOKEN_KEY` (misma custodia).
 * NUNCA loguear el contenido descifrado.
 */
import crypto from "crypto";

function fiscalKey(): Buffer {
  const raw = process.env.FISCAL_KEY || process.env.MP_TOKEN_KEY || "";
  if (!raw) throw new Error("FISCAL_KEY (o MP_TOKEN_KEY) no configurada");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptFiscalSecret(plain: string): string {
  const key = fiscalKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptFiscalSecret(payload: string): string {
  const key = fiscalKey();
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Secreto fiscal corrupto");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Valida formato de CUIT argentino (11 dígitos + dígito verificador). */
export function isValidCuit(cuit: string): boolean {
  const d = (cuit || "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(d)) return false;
  const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * mult[i];
  const mod = 11 - (sum % 11);
  const verif = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return verif === Number(d[10]);
}
