/**
 * Check del login con Google (OAuth 2.0 / OIDC).
 *
 * Verifica invariantes que no se pueden romper sin darse cuenta:
 *  1. Migración idempotente (google_sub + índice UNIQUE parcial) y espejada
 *     en el schema canónico (instalaciones nuevas).
 *  2. El state es HMAC y solo acepta rutas internas (no open redirect).
 *  3. El id_token se verifica contra el JWKS de Google (firma + issuer +
 *     audiencia + email verificado).
 *  4. El callback exige el doble submit del state (cookie) y responde 503
 *     nombrando la migración si falta.
 *  5. El callback conserva el 2FA de admins y no toca cuentas vinculadas a
 *     otra cuenta de Google; las no confirmadas pierden la contraseña.
 *  6. El botón se autooculta sin credenciales (status) y está SOLO en las
 *     pestañas de cuenta personal (login "Mi cuenta" y /registro).
 *  7. El deploy escribe las env solo si los secrets existen (fail-open).
 *  8. El login por contraseña avisa cuando la cuenta es solo-Google.
 *
 *   node scripts/check-google-auth.mjs
 */
import fs from "fs";
import path from "path";

let failed = 0;
function fail(msg) {
  console.error(`[check-google-auth] FAIL: ${msg}`);
  failed++;
}
function ok(msg) {
  console.log(`[check-google-auth] OK: ${msg}`);
}
function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}
function mustInclude(rel, needle, label) {
  const src = read(rel);
  if (!src.includes(needle)) fail(`${label || rel}: falta "${needle}"`);
  else ok(`${label || rel}: ${needle}`);
}

// 1) Migración + schema
const migration = "supabase/self-host/migrate-google-auth.sql";
mustInclude(migration, "ADD COLUMN IF NOT EXISTS google_sub text", "migración");
mustInclude(migration, "profiles_google_sub_key", "migración");
mustInclude(migration, "WHERE google_sub IS NOT NULL", "migración");
if (/DROP\s+COLUMN|DELETE\s+FROM/i.test(read(migration))) fail("migración: no debe borrar datos");

const schema = read("supabase/self-host/schema.sql");
if (!/google_sub text/.test(schema)) fail("schema.sql: falta profiles.google_sub");
else ok("schema.sql: profiles.google_sub");
if (!/profiles_google_sub_key/.test(schema)) fail("schema.sql: falta el índice UNIQUE de google_sub");
else ok("schema.sql: índice de google_sub");

// 2) State firmado + next interno
const lib = "src/lib/google-auth.ts";
mustInclude(lib, "createHmac(", "google-auth");
mustInclude(lib, "timingSafeEqual(", "google-auth");
mustInclude(lib, 'value.startsWith("//")', "google-auth");
mustInclude(lib, "STATE_TTL_MS", "google-auth");
mustInclude(lib, "GOOGLE_STATE_COOKIE", "google-auth");

// 3) Verificación del id_token
mustInclude(lib, "createRemoteJWKSet", "google-auth");
mustInclude(lib, "jwtVerify(", "google-auth");
mustInclude(lib, "issuer: GOOGLE_ISSUERS", "google-auth");
mustInclude(lib, "audience: clientId", "google-auth");
mustInclude(lib, "email_verified", "google-auth");

// 4) Callback: doble submit + migración
const callback = "src/app/api/auth/google/callback/route.ts";
mustInclude(callback, "state !== cookieState", "callback");
mustInclude(callback, "verifyOAuthState(state)", "callback");
mustInclude(callback, "hasGoogleSubColumn()", "callback");
mustInclude(callback, 'fail("google_migration")', "callback");
mustInclude(callback, "googleStateCookieOpts(0)", "callback");

// 5) Reglas de cuenta
mustInclude(callback, "FOR UPDATE", "callback");
mustInclude(callback, "google_conflict", "callback");
mustInclude(callback, "password_hash = CASE WHEN $3 THEN '' ELSE password_hash END", "callback");
mustInclude(callback, "signPending2faToken", "callback");
mustInclude(callback, "setAuthSessionCookies", "callback");
mustInclude(callback, "isTeamProfile", "callback");
mustInclude(callback, 'fail("google_staff")', "callback");

// 6) Botón + rutas
mustInclude("src/components/auth/google-button.tsx", "/api/auth/google/status", "botón");
mustInclude("src/components/auth/google-button.tsx", "enabled !== true", "botón");
mustInclude("src/app/api/auth/google/status/route.ts", "isGoogleAuthEnabled()", "status");

const loginPage = read("src/app/login/page.tsx");
const loginButtons = loginPage.match(/<GoogleButton/g)?.length || 0;
if (loginButtons !== 1) fail(`/login: se espera 1 <GoogleButton> (hay ${loginButtons})`);
else ok("/login: 1 botón de Google (pestaña Mi cuenta)");
if (!/Google es solo para cuentas personales/.test(loginPage)) {
  fail("/login: falta la aclaración en la pestaña 'Soy del equipo'");
} else ok("/login: aclaración del equipo");
if (!/google_migration/.test(loginPage)) fail("/login: falta el mapeo de errores de Google");
else ok("/login: mapeo de errores de Google");

mustInclude("src/app/registro/page.tsx", "<GoogleButton", "/registro");

// 7) Deploy fail-open
const deploy = read(".github/workflows/deploy.yml");
if (!/if \[ -n "\$GOOGLE_ID" \] && \[ -n "\$GOOGLE_SECRET" \]/.test(deploy)) {
  fail("deploy.yml: las env de Google deben escribirse solo si los secrets existen");
} else ok("deploy.yml: env de Google fail-open");
mustInclude(".github/workflows/deploy.yml", "GOOGLE_CLIENT_ID=$GOOGLE_ID", "deploy.yml");
mustInclude(".github/workflows/deploy.yml", "GOOGLE_CLIENT_SECRET=$GOOGLE_SECRET", "deploy.yml");

// OJO: el compose pasa las variables con una lista `environment:` explícita:
// escribirlas en .env no alcanza, hay que mapearlas acá también.
const compose = read("docker-compose.yml");
for (const name of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "GOOGLE_AUTH_ENABLED"]) {
  if (!compose.includes(`- ${name}=`)) fail(`docker-compose.yml: falta mapear ${name} al contenedor app`);
  else ok(`docker-compose.yml: ${name} mapeada al contenedor app`);
}

// 8) Login por contraseña: fix del SQL y aviso de cuenta solo-Google
const loginRoute = read("src/app/api/auth/login/route.ts");
if (/FROM profiles'/.test(loginRoute)) fail("login/route.ts: comilla suelta en el SELECT por WhatsApp");
else ok("login/route.ts: SQL por WhatsApp sin comilla suelta");
mustInclude("src/app/api/auth/login/route.ts", "google_account", "login/route.ts");
mustInclude("src/app/api/auth/login/route.ts", "usesGoogleLogin", "login/route.ts");

if (failed > 0) {
  console.error(`\n[check-google-auth] ${failed} problema(s).`);
  process.exit(1);
}
console.log("\n[check-google-auth] Todo OK.");
