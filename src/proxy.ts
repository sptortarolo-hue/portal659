import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { DEVICE_COOKIE, newDeviceId, deviceCookieOptions } from "@/lib/device";

/**
 * Sesión de equipo del local (login "Soy del equipo": empleado o encargado).
 * El token lleva el claim `staff: true` (ver signAccessToken en lib/auth.ts)
 * y esta sesión NO navega el sitio público: siempre vuelve a su panel.
 * Excepciones a propósito: su perfil (/perfil) y los manuales (/manuales).
 * El repartidor (login propio, sin el claim) no se ve afectado.
 */
const STAFF_HOME = "/vendor/dashboard";
const STAFF_ALLOWED = ["/perfil", "/manuales"];
/** Dentro de /vendor, secciones que son solo del dueño (plata y bot). */
const STAFF_BLOCKED = ["/vendor/suscripcion", "/vendor/wa-bot"];
/** Rutas que no son páginas: nunca se redirige (los fetch del panel pasan). */
const STAFF_SKIP = ["/api", "/manifest.json", "/robots.txt", "/sitemap.xml"];

function staffPathAllowed(pathname: string): boolean {
  if (STAFF_SKIP.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  if (pathname === STAFF_HOME || pathname.startsWith("/vendor/")) {
    return !STAFF_BLOCKED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  }
  return STAFF_ALLOWED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * ¿La sesión actual es de equipo? Verifica el claim `staff` con jose puro
 * (sin pg ni argon2: este archivo corre en el proxy de Next). Fail-open:
 * sin token, con token inválido o sin JWT_SECRET se comporta como siempre.
 * Se prueban todas las cookies `sb-access-token` (puede convivir la variante
 * host-only legacy con la de dominio, igual que getAuthUser).
 */
async function isStaffSession(request: NextRequest): Promise<boolean> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return false;
  const tokens = request.cookies.getAll("sb-access-token").map((c) => c.value).filter(Boolean);
  if (tokens.length === 0) return false;
  const key = new TextEncoder().encode(secret);
  for (const token of tokens) {
    try {
      const { payload } = await jwtVerify(token, key);
      if ((payload as { staff?: unknown }).staff === true) return true;
    } catch {
      /* token vencido/inválido: probar el siguiente candidato */
    }
  }
  return false;
}

/** Empleado/encargado fuera de su panel → al dashboard. null = seguir. */
async function staffLock(request: NextRequest): Promise<NextResponse | null> {
  if (staffPathAllowed(request.nextUrl.pathname)) return null;
  if (!(await isStaffSession(request))) return null;
  const url = request.nextUrl.clone();
  url.pathname = STAFF_HOME;
  url.search = "";
  return NextResponse.redirect(url);
}

/**
 * CORS para las apps nativas (Capacitor WebView: Portal Reparto).
 * La app corre en origen `capacitor://localhost` (iOS/Android) o
 * `https://localhost` y llama a /api con fetch + JSON + Bearer: sin estos
 * headers el preflight OPTIONS vuelve sin Access-Control-Allow-Origin, el
 * WebView bloquea y el fetch tira TypeError ("Sin conexión al servidor").
 *
 * La web corre same-origin y no necesita nada de esto.
 * Sin Allow-Credentials a propósito: la app autentica con Bearer (header),
 * no con cookies — un origen cualquiera nunca recibe cookies por acá.
 */
const APP_ORIGIN_RE =
  /^(capacitor|ionic):\/\/localhost$|^https?:\/\/localhost(:\d+)?$/;

function applyCors(request: NextRequest, response: NextResponse): NextResponse {
  const origin = request.headers.get("origin");
  if (origin && APP_ORIGIN_RE.test(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "authorization, content-type");
    response.headers.set("Access-Control-Max-Age", "86400");
    response.headers.set("Vary", "Origin");
  }
  return response;
}

export async function proxy(request: NextRequest) {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    if (origin && APP_ORIGIN_RE.test(origin)) {
      return new NextResponse(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, content-type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }
    return NextResponse.next();
  }

  // Empleado/encargado: no sale de su comercio (salvo /perfil y /manuales).
  // Va primero: si redirige, no hace falta tocar las cookies de dispositivo.
  const lock = await staffLock(request);
  if (lock) return lock;

  if (request.cookies.get(DEVICE_COOKIE)) {
    return applyCors(request, NextResponse.next());
  }

  const response = NextResponse.next();
  response.cookies.set(DEVICE_COOKIE, newDeviceId(), deviceCookieOptions());
  return applyCors(request, response);
}

export const config = {
  // api/share y /og/* (tarjetas og:image) y /og-cover.jpg quedan fuera: son
  // imágenes — un Set-Cookie impide que el CDN las cachee (y el crawler de
  // WhatsApp no necesita cookie de dispositivo).
  matcher: "/((?!_next/static|_next/image|favicon.ico|sw\\.js|icons|uploads|api/share|og/|og-cover\\.jpg).*)",
};