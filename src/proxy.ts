import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_COOKIE, newDeviceId, deviceCookieOptions } from "@/lib/device";

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

export function proxy(request: NextRequest) {
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