/**
 * Verificación de hardening de seguridad (P0).
 * Corre con: node scripts/check-security.mjs
 *
 * Checks estáticos sobre el código (no runtime):
 *   1. Cabeceras de seguridad en next.config.ts (X-Frame-Options, nosniff,
 *      Referrer-Policy, HSTS, Permissions-Policy, CSP Report-Only).
 *   2. /api/seed bloqueado en producción.
 *   3. Webhook MP en modo fail-closed (rechaza sin MP_WEBHOOK_SECRET en prod).
 *   4. Todas las rutas /api/admin/.../route.ts pasan por isAdmin(request).
 *   5. Endpoints de 2FA existen y totp usa timingSafeEqual + AES-256-GCM.
 *   6. CSP report endpoint existe.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(p) {
  try {
    return readFileSync(join(root, p), "utf8");
  } catch {
    return null;
  }
}

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
};

// --- 1. Cabeceras de seguridad --------------------------------------------
const nextConfig = read("next.config.ts") || "";
for (const h of [
  "X-Frame-Options",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Strict-Transport-Security",
  "Permissions-Policy",
  "Content-Security-Policy-Report-Only",
]) {
  check(`next.config.ts declara ${h}`, nextConfig.includes(h));
}
check(
  "next.config.ts usa SAMEORIGIN (no DENY roto de iframes propios)",
  nextConfig.includes('value: "SAMEORIGIN"')
);
check(
  "next.config.ts HSTS incluye includeSubDomains",
  nextConfig.includes("includeSubDomains")
);
check(
  "next.config.ts geolocation=(self) (repartidor comparte ubicación)",
  nextConfig.includes("geolocation=(self)")
);

// --- 2. /api/seed bloqueado en prod ---------------------------------------
const seed = read("src/app/api/seed/route.ts") || "";
check(
  "/api/seed retorna 404 en production",
  /NODE_ENV.*production/.test(seed) && /status:\s*404/.test(seed)
);

// --- 3. Webhook MP fail-closed --------------------------------------------
const mpWh = read("src/app/api/webhooks/mercadopago/route.ts") || "";
check(
  "webhook MP: fail-closed sin secret (status 500 en prod)",
  mpWh.includes("fail-closed") && /status:\s*500/.test(mpWh)
);
check(
  "webhook MP: rechaza sin data.id en prod (401)",
  /sin data\.id/i.test(mpWh) && /status:\s*401/.test(mpWh)
);
check(
  "webhook MP: maneja ping sin firma",
  mpWh.includes('body?.type === "ping"')
);

// --- 4. Rutas admin protegidas por isAdmin ---------------------------------
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (name === "route.ts") out.push(full);
  }
  return out;
}
const adminDir = join(root, "src/app/api/admin");
const adminRoutes = walk(adminDir);
let unprotected = [];
for (const f of adminRoutes) {
  const content = readFileSync(f, "utf8");
  if (!/isAdmin\s*\(/.test(content)) unprotected.push(relative(root, f));
}
check(
  `todas las rutas admin (${adminRoutes.length}) usan isAdmin(request)`,
  unprotected.length === 0,
  unprotected.length ? unprotected.join(", ") : undefined
);

// --- 5. 2FA TOTP -----------------------------------------------------------
const totp = read("src/lib/totp.ts") || "";
check("src/lib/totp.ts existe", totp.length > 0);
check("TOTP usa timingSafeEqual (anti timing)", totp.includes("timingSafeEqual"));
check("TOTP cifra con AES-256-GCM", totp.includes('aes-256-gcm'));
check("TOTP tiene anti-replay por step", totp.includes("lastStep"));
for (const ep of [
  "src/app/api/auth/2fa/setup/route.ts",
  "src/app/api/auth/2fa/enable/route.ts",
  "src/app/api/auth/2fa/disable/route.ts",
  "src/app/api/auth/2fa/verify-login/route.ts",
  "src/app/api/auth/2fa/status/route.ts",
]) {
  check(`${ep} existe`, !!read(ep));
}
const verifyLogin = read("src/app/api/auth/2fa/verify-login/route.ts") || "";
check("verify-login firma sesión real (signAccessToken)", verifyLogin.includes("signAccessToken"));
check("verify-login setea cookies de sesión", verifyLogin.includes('sb-access-token'));

// --- 6. CSP report endpoint ------------------------------------------------
const cspReport = read("src/app/api/csp-report/route.ts") || "";
check("endpoint /api/csp-report existe", cspReport.length > 0);
check("csp-report registra violaciones (logApiError)", cspReport.includes("logApiError"));

// --- 7. Login challenge + callback gating ---------------------------------
const loginRoute = read("src/app/api/auth/login/route.ts") || "";
check("login route emite desafío need2fa", loginRoute.includes("need2fa: true"));
check("login route firma pending token", loginRoute.includes("signPending2faToken"));
const callback = read("src/app/auth/callback/route.ts") || "";
check("callback magic-link respeta 2FA", callback.includes("totp_enabled") && callback.includes("pending="));

console.log(`\n${failures === 0 ? "OK" : "FALLOS"}: ${failures} fallo(s)`);
process.exit(failures === 0 ? 0 : 1);
PY