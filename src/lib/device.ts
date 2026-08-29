export const DEVICE_COOKIE = "portal659-did";
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseCookiesHeader(cookieHeader: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function getDeviceId(request: Request): string | null {
  const cookies = parseCookiesHeader(request.headers.get("cookie"));
  return cookies[DEVICE_COOKIE] || null;
}

export function newDeviceId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function deviceCookieOptions(): {
  httpOnly: boolean;
  sameSite: "lax";
  path: string;
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  };
}