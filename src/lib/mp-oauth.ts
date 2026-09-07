/**
 * Mercado Pago Multi-Market — OAuth por comercio.
 *
 * Cada comercio conecta su propia cuenta de Mercado Pago vía OAuth; los tokens
 * se guardan CIFRADOS (AES-256-GCM) en `vendors.mp_*` así los cobros online de
 * sus clientes caen directo a la cuenta de MP del comercio, no a la del portal.
 *
 * Seguridad:
 *  - `MP_TOKEN_KEY` (env, 32+ bytes) cifra los tokens en reposo. Sin ella no se
 *    puede leer nada de la DB.
 *  - El flujo OAuth usa un `state` firmado con HMAC sobre (vendor_id|nonce|ts)
 *    usando `JWT_SECRET`, con expiración de 10 minutos — evita CSRF y que un
 *    callback malicioso vincule una cuenta de MP a otro comercio.
 *  - NUNCA loguear tokens ni claves.
 */

import crypto from "crypto";
import { queryOne } from "@/lib/db";

const MP_AUTH_URL = "https://auth.mercadopago.com.ar/authorization";
const MP_TOKEN_URL = "https://api.mercadopago.com/oauth/token";

// Ventana de seguridad: si el token vence en menos de esto, lo refrescamos antes.
const REFRESH_BUFFER_MS = 10 * 60 * 1000;
// El state del OAuth expira en 10 minutos (anti-replay / anti-CSRF).
const STATE_TTL_MS = 10 * 60 * 1000;

export type VendorMpRow = {
  id: string;
  mp_access_token: string | null;
  mp_refresh_token: string | null;
  mp_public_key: string | null;
  mp_user_id: number | null;
  mp_expires_at: string | null;
  mp_connected_at: string | null;
};

// ============================================================
// Cifrado AES-256-GCM (en reposo)
// ============================================================

function tokenKey(): Buffer {
  const raw = process.env.MP_TOKEN_KEY || "";
  if (!raw) throw new Error("MP_TOKEN_KEY no configurada");
  // Acepta hex (64 chars) o cualquier string: la derivamos con sha256 para 32 bytes fijos.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const key = tokenKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const key = tokenKey();
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

// ============================================================
// State firmado (anti-CSRF / anti-swap de comercios)
// ============================================================

function stateHmac(payload: string): string {
  const secret = process.env.JWT_SECRET || "";
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signState(vendorId: string): string {
  const payload = `${vendorId}|${crypto.randomUUID()}|${Date.now()}`;
  return `${payload}|${stateHmac(payload)}`;
}

export function verifyState(state: string): { vendorId: string } | null {
  const parts = state.split("|");
  if (parts.length !== 4) return null;
  const [vendorId, nonce, tsStr, sig] = parts;
  const payload = `${vendorId}|${nonce}|${tsStr}`;
  const expected = stateHmac(payload);
  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || Date.now() - ts > STATE_TTL_MS) return null;
  return { vendorId };
}

// ============================================================
// URLs / llamadas a MP
// ============================================================

export function buildConnectUrl(vendorId: string, redirectUri: string): string {
  const clientId = process.env.MP_CLIENT_ID || "";
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    platform_id: "mp",
    redirect_uri: redirectUri,
    state: signState(vendorId),
  });
  return `${MP_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<{
  ok: boolean;
  error?: string;
  accessToken?: string;
  refreshToken?: string;
  publicKey?: string | null;
  userId?: number | null;
  expiresInSec?: number;
}> {
  const client_id = process.env.MP_CLIENT_ID || "";
  const client_secret = process.env.MP_CLIENT_SECRET || "";
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id,
    client_secret,
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(MP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    return { ok: false, error: data?.message || `MP respondió ${res.status}` };
  }
  return {
    ok: true,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    publicKey: data.public_key ?? null,
    userId: data.user_id != null ? Number(data.user_id) : null,
    expiresInSec: data.expires_in ?? 15552000,
  };
}

async function refreshTokens(refreshToken: string): Promise<{
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  publicKey?: string | null;
  userId?: number | null;
  expiresInSec?: number;
}> {
  const client_id = process.env.MP_CLIENT_ID || "";
  const client_secret = process.env.MP_CLIENT_SECRET || "";
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id,
    client_secret,
    refresh_token: refreshToken,
  });
  try {
    const res = await fetch(MP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.access_token) return { ok: false };
    return {
      ok: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      publicKey: data.public_key ?? null,
      userId: data.user_id != null ? Number(data.user_id) : null,
      expiresInSec: data.expires_in ?? 15552000,
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Devuelve el access_token del comercio listo para usar, refrescándolo si está
 * por vencer. Retorna null si no está conectado o si el refresh falla.
 * El token se usa SOLO en server: nunca se expone al browser ni se loguea.
 */
export async function getVendorMpToken(vendor: VendorMpRow): Promise<string | null> {
  if (!vendor.mp_access_token) return null;

  const expiresAt = vendor.mp_expires_at ? new Date(vendor.mp_expires_at).getTime() : 0;
  const needsRefresh = expiresAt - REFRESH_BUFFER_MS < Date.now();

  if (!needsRefresh) {
    try {
      return decryptSecret(vendor.mp_access_token);
    } catch {
      return null;
    }
  }

  // Vencido o por vencer: refrescar
  if (!vendor.mp_refresh_token) return null;
  let refreshPlain: string;
  try {
    refreshPlain = decryptSecret(vendor.mp_refresh_token);
  } catch {
    return null;
  }

  const refreshed = await refreshTokens(refreshPlain);
  if (!refreshed.ok || !refreshed.accessToken) return null;

  // Persistir rotado (access + refresh), cifrado.
  const newExpiresAt = new Date(Date.now() + (refreshed.expiresInSec || 15552000) * 1000).toISOString();
  try {
    await queryOne(
      `UPDATE vendors
       SET mp_access_token = $1, mp_refresh_token = $2, mp_expires_at = $3,
           mp_public_key = COALESCE($4, mp_public_key),
           mp_user_id = COALESCE($5, mp_user_id)
       WHERE id = $6`,
      [
        encryptSecret(refreshed.accessToken),
        encryptSecret(refreshed.refreshToken || ""),
        newExpiresAt,
        refreshed.publicKey || null,
        refreshed.userId ?? null,
        vendor.id,
      ]
    );
  } catch {
    // Si falla el persist igual devolvemos el token para esta llamada.
  }
  return refreshed.accessToken;
}
