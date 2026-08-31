// URL base del sitio para construir links (emails, redirects).
// En producción SIEMPRE usa el dominio online; el header `origin` solo se
// considera en desarrollo (localhost). Evita que mails/links apunten a localhost.
export function getSiteUrl(request?: Request): string {
  const env = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

  if (process.env.NODE_ENV !== "production") {
    if (env) return env;
    const origin = request?.headers.get("origin");
    if (origin) return origin.replace(/\/$/, "");
    return "http://localhost:3000";
  }

  // Producción: dominio online siempre.
  return env || "https://www.portal659.com.ar";
}