import crypto from "crypto";

/**
 * TOTP (RFC 6238) + cifrado del secreto en reposo.
 * Sin dependencias externas: todo sobre `node:crypto`.
 */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Base32 RFC 4648, sin padding (lo que esperan Google Authenticator/Authy). */
export function base32Encode(buf: Buffer): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = (s || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo: 20 bytes = 160 bits (recomendación RFC 4226). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export const TOTP_STEP = 30;

function hotp(secretB32: string, counter: number): string {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  // counter cabe en 64 bits; Date.now()/30 es chico, pero escribimos big-endian.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export function totpNow(secretB32: string, at: number = Date.now()): string {
  return hotp(secretB32, Math.floor(at / 1000 / TOTP_STEP));
}

/**
 * Verifica un código con ventana de ±1 paso (30s c/u) y anti-replay:
 * `lastStep` es el último paso aceptado; no se acepta el mismo ni uno viejo.
 * Devuelve el paso verificado (para persistirlo) o null si es inválido.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  lastStep?: number | null
): { ok: true; step: number } | { ok: false } {
  const clean = (code || "").replace(/\D/g, "");
  if (clean.length !== 6) return { ok: false };
  const nowStep = Math.floor(Date.now() / 1000 / TOTP_STEP);
  for (let i = 1; i >= -1; i--) {
    const step = nowStep + i;
    if (lastStep != null && step <= lastStep) continue;
    const candidate = hotp(secretB32, step);
    const a = Buffer.from(candidate);
    const b = Buffer.from(clean);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}

export function otpauthUrl(secretB32: string, account: string): string {
  const issuer = "Portal 659";
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP}`;
}

// ============================================================
// Cifrado del secreto en reposo (AES-256-GCM, mismo formato que
// mp-oauth.ts: iv.tag.data). Deriva la clave de JWT_SECRET para no
// depender de MP_TOKEN_KEY.
// ============================================================
function totpKey(): Buffer {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) throw new Error("JWT_SECRET no configurada");
  return crypto.createHash("sha256").update(`${secret}|totp`).digest();
}

export function encryptTotpSecret(plain: string): string {
  const key = totpKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decryptTotpSecret(payload: string): string | null {
  try {
    const key = totpKey();
    const [ivB64, tagB64, dataB64] = (payload || "").split(".");
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** ¿El error es por la migración 2FA sin aplicar? (para 503 nombrando el archivo) */
export function isMissing2faMigration(e: unknown): boolean {
  const msg = (e as Error)?.message || "";
  return /totp_(secret|enabled|last_step)/i.test(msg) || (/does not exist/i.test(msg) && /totp/i.test(msg));
}
