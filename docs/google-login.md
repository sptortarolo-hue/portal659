# Login con Google — Portal 659

Ingreso con Google (OAuth 2.0 / OpenID Connect) para las **cuentas personales** del portal. La sesión sigue siendo el **JWT propio** (`src/lib/auth.ts`): Google solo prueba la identidad del email; después se emiten las mismas cookies `sb-access-token` / `sb-refresh-token` que el login por contraseña.

## Qué cuentas usan Google

| Quién | ¿Google? |
|---|---|
| Comprador / cliente | Sí (crea la cuenta si el email no existe) |
| Dueño de comercio (`role='vendor'`) | Sí, si el email del comercio coincide. Es la misma cuenta personal: entra directo a `/vendor/dashboard`. |
| Admin | Sí. Si tiene 2FA activado, **igual pide el código TOTP**. |
| Equipo del local (empleado/encargado) | No. Entra con comercio + usuario + contraseña ("Soy del equipo"). Su perfil tiene un email sintético `@staff.portal659.local`. |
| Repartidor | No. Tiene su login propio por teléfono. |

## Flujo

```
GET /api/auth/google?next=/checkout
  → state firmado (HMAC JWT_SECRET, 10 min) + cookie portal659-google-state
  → redirect a accounts.google.com (scope openid email profile, prompt=select_account)

GET /api/auth/google/callback?code=...&state=...
  → valida state (firma + TTL + cookie: doble submit anti login-CSRF)
  → canjea el code en oauth2.googleapis.com/token
  → verifica el id_token (JWKS de Google, issuer, aud=client_id, email_verified)
  → resuelve la cuenta:
      google_sub ya vinculado → entra
      email existente sin vincular → vincula (si estaba sin confirmar, confirma y borra la contraseña)
      email vinculado a otra cuenta de Google → error google_conflict
      perfil del equipo del local (vendor_staff) → error google_staff
      email nuevo → crea perfil comprador (password_hash = '')
  → admin con 2FA → /login?pending=... (pide TOTP)
  → emite cookies de sesión y redirige a `next` (solo rutas internas)
```

El botón se autooculta si el servidor no tiene credenciales (`GET /api/auth/google/status`).

## Variables de entorno

| Variable | Obligatoria | Qué hace |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Sí | Client ID de OAuth (Web application). |
| `GOOGLE_CLIENT_SECRET` | Sí | Client secret. |
| `GOOGLE_REDIRECT_URI` | No | Fija la redirect URI exacta si el dominio público difiere del de la app. Default: `${NEXT_PUBLIC_SITE_URL}/api/auth/google/callback`. |
| `GOOGLE_AUTH_ENABLED` | No | `0` apaga todo el login con Google sin borrar las credenciales. |

Sin `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` no pasa nada: el botón no aparece y el resto del sitio funciona igual. El deploy (`.github/workflows/deploy.yml`) escribe las variables solo si los secrets existen.

## Alta en Google Cloud Console (una vez)

1. Crear (o elegir) un proyecto.
2. **OAuth consent screen** → tipo **External** → scopes `openid`, `email`, `profile`.
   - Mientras esté en **Testing**, solo pueden entrar los *test users* cargados.
   - Para que entre cualquiera hay que **publicarla** (Google puede pedir verificación si se usan scopes sensibles; `email`/`profile` son básicos).
3. **Credentials → Create credentials → OAuth client ID → Web application**:
   - **Authorized JavaScript origins**:
     - `https://www.portal659.com.ar`
     - `http://localhost:3000` y/o el puerto de tu dev (en este repo `NEXT_PUBLIC_SITE_URL` apunta a `http://localhost:3001`)
   - **Authorized redirect URIs**:
     - `https://www.portal659.com.ar/api/auth/google/callback`
     - `http://localhost:3000/api/auth/google/callback` (o el puerto de tu dev, ej. `:3001`)
4. Copiar Client ID y Client secret a los secrets de GitHub: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (opcional `GOOGLE_REDIRECT_URI`).

## Migración

```
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-google-auth.sql
```

Agrega `profiles.google_sub` + índice UNIQUE parcial. Sin la migración, el callback redirige con `?error=google_migration` y el login por contraseña sigue funcionando (la consulta de la columna es tolerante).

## Verificación manual

1. **Cuenta nueva**: "Continuar con Google" → se crea el perfil y entra al sitio.
2. **Comprador existente** con el mismo email → vincula y conserva favoritos/pedidos.
3. **Dueño de comercio** con el email del local → entra a `/vendor/dashboard`.
4. **Admin con 2FA** → pide el código TOTP después de Google.
5. **Perfil sin confirmar** con ese email → queda confirmado y con `password_hash = ''`.
6. **`state` vencido o manipulado** (o abrir el callback en otro navegador) → `?error=google_state`.
7. **Login por contraseña de una cuenta solo-Google** → "Esta cuenta usa Google…".
8. **Sin credenciales** → el botón no aparece y `/api/auth/google` redirige a `?error=google_disabled`.

## Troubleshooting

| Síntoma | Causa probable |
|---|---|
| `redirect_uri_mismatch` en Google | La URI registrada no coincide exactamente (dominio, `www`, http/https, barra final). Revisar `GOOGLE_REDIRECT_URI`. |
| `?error=google_disabled` | Faltan `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` en el `.env` o `GOOGLE_AUTH_ENABLED=0`. |
| `?error=google_token` | El id_token no verificó (reloj del server, client ID distinto, email sin verificar en Google). |
| `?error=google_exchange` | El code ya se usó/expiró (recargar el callback) o el client secret es incorrecto. |
| `?error=google_migration` | Falta aplicar `migrate-google-auth.sql`. |
| `?error=google_conflict` | El email ya está vinculado a otra cuenta de Google; entrar con contraseña. |
| `?error=google_staff` | Es una cuenta del equipo del local (empleado/encargado/repartidor): entra por "Soy del equipo" o su login de reparto. |
| "Access blocked: app not verified" | La consent screen sigue en Testing y el usuario no es test user, o falta publicarla. |

## Archivos

- `src/lib/google-auth.ts` — state HMAC, URL de Google, canje del code, verificación del id_token, chequeo de migración.
- `src/app/api/auth/google/route.ts` — inicia el flujo.
- `src/app/api/auth/google/callback/route.ts` — vuelta, resolución de cuenta y sesión.
- `src/app/api/auth/google/status/route.ts` — `{ enabled }` para el botón.
- `src/components/auth/google-button.tsx` — botón compartido.
- `supabase/self-host/migrate-google-auth.sql` — `profiles.google_sub`.
- `scripts/check-google-auth.mjs` — verificación estática de invariantes.
