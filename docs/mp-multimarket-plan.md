# Plan: Mercado Pago Multi-Market (OAuth por comercio)

> Estado: **APROBADO, listo para implementar**. Documento de decisión + guía de implementación.

## 1. Problema a resolver

Hoy el portal tiene **una sola cuenta de Mercado Pago** (la del portal, en `MP_ACCESS_TOKEN` de `.env`). Todos los cobros online de **todos los comercios** entran a la cuenta del portal.

**Objetivo:** que cada comercio cobre **directo en su propia cuenta de Mercado Pago**, sin que el portal toque la guita. La plataforma actúa como "Aplicación Conectora": el comercio la autoriza mediante OAuth y listo, una sola vez.

## 2. Arquitectura (flujo)

```
[Comercio] —(toca "Conectar MP" en su panel)→ [Pantalla de login de MP (externa)]
    → MP devuelve un `code` al callback del portal
    → Portal intercambia `code` → `access_token + refresh_token + user_id`
    → Se guardan CIFRADOS en la DB ligados al comercio (nunca en .env, nunca al browser)

[Cliente] —(toca "Pagar con MP" en el micrositio del comercio X)→ portal crea la preferencia
    con el TOKEN DEL COMERCIO X (server-side, descifrado en memoria)
    → el cliente paga → la guita va DIRECTO a la cuenta MP del comercio X
    → MP avisa al webhook → el webhook ve `user_id` en el payload → resuelve el comercio
       correspondiente → usa su token → confirma el pago → crea pedido/notifica
```

**Suscripciones a tu plataforma (el cobro del plan al comercio) quedan exactamente igual** — entran a la cuenta del portal (token global). Solo cambia el **cobro de end-user al comercio**.

## 3. Seguridad (nodos críticos ya decididos)

| Aspecto | Decisión |
|---|---|
| **Tokens en DB** | Cifrados AES-256-GCM con `MP_TOKEN_KEY` (env). Nunca en plano en la DB ni backup. |
| **Tokens nunca al browser** | Todo el intercambio código↔token y todo call a MP es server-side. El navegador nunca ve un token. |
| **Nunca loguear tokens** | Ni en consola, ni en error, ni en print statements. |
| **Emparejamiento seguro** | El `state` del OAuth es firmado con HMAC (`JWT_SECRET`): contiene vendor_id + timestamp + nonce. Evita CSRF/intercambio de comercios. |
| **Reembolsos** | **NO se exponen en el MVP.** El comercio sigue haciendo reembolsos desde su app MP (con su 2FA propio). Nosotros no agregamos endpoint de refund en esta versión. |
| **Revocación** | El comercio puede quitar la vinculación desde su MP (Ajustes → Apps vinculadas) o desde el botón "Desconectar" en su panel. En cualquier caso el token viejo muere. |
| **MP no tiene 2FA en API** | El token = la credencial. Por eso el cifrado + no exponer refund. La salida de emergencia es la revocación por el comercio. |

### Riesgo residual (honesto)
Si se compromete la DB **y** el server (para robar `MP_TOKEN_KEY` y descifrado), alguien con el token podría:
- Crear preferencias (cobros en nombre del comercio) — la guita sigue yendo al MP del comercio, no se pierde.
- Consultar pagos del comercio.
- Si **efectivamente se hubiera expuesto** una función de refund (en este MVP no la hay): devolver guita a compradores.

No puede: sacar guita, transferir, cambiar contraseña, ver datos del comercio más allá de sus cobros.

## 4. Flujo del comerciante (UI)

Panel → Configuración → sección "💳 Cobrar con Mercado Pago":

- **No conectado**: explicación ("Tus clientes pagan online y te cae directo en tu MP — sin intermediarios") + botón **"Conectar con Mercado Pago"**.
- **Flujo**: va a la pantalla oficial de MP (azul), se loguea con su cuenta de siempre, toca "Permitir", vuelve al panel.
- **Conectado**: "✅ Conectado — los cobros entran directo a tu cuenta (usuario MP #XXX)" + botón **Desconectar**.
- **Sin conectar MP**: ese comercio **no ve el botón "Pagar con Mercado Pago"** en su checkout (solo WhatsApp) — porque si no la guita del cliente caería a tu cuenta y eso no es lo correcto para ellos.

## 5. Cambios técnicos

### 5.1 DB — `supabase/self-host/migrate-mp-oauth.sql`
```
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS mp_user_id bigint UNIQUE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS mp_access_token text;      -- cifrado
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS mp_refresh_token text;     -- cifrado
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS mp_public_key text;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS mp_expires_at timestamptz;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS mp_connected_at timestamptz;
-- Correr: docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-mp-oauth.sql
```

### 5.2 Lib nueva `src/lib/mp-oauth.ts`
- `buildConnectUrl(state)` → URL de autorización de MP.
- `signState(vendorId)` / `verifyState(state)` — HMAC con `JWT_SECRET` (vendor_id|nonce|ts, expira 10 min).
- `exchangeCode(code)` → POST a `https://api.mercadopago.com/oauth/token`.
- `getVendorMpToken(vendor)` → si falta <10min para vencer, hace `refresh_token` y persiste (sin loguear). Devuelve el token **descifrado** listo para usar, o `null` si no hay.
- `encryptSecret/decryptSecret` (AES-256-GCM, `MP_TOKEN_KEY`, nonce único por valor).

### 5.3 Endpoints
- `GET /api/mp/connect` — guard vendor → redirige a MP con el state firmado.
- `GET /api/mp/oauth/callback` — valida state, intercambia el código, guarda tokens cifrados + `mp_user_id` + `mp_public_key`, redirige a `/vendor/dashboard?mp=connected` (o `?mp=error`).
- `POST /api/vendor/mp/disconnect` — limpia las columnas del comercio.

### 5.4 Pagos (`src/app/api/payments/route.ts`)
- Lee `vendorId`; obtiene `getVendorMpToken(vendor)`; si no hay conexión → **error claro** ("Cobro online no disponible — comercio sin conectar MP").
- Crea la preferencia con **su token** y `notification_url` + `metadata.stock_items` (igual que hoy; ya envía vendor_id por `external_reference`).
- `GET /api/payments?vendorId=...` → devuelve `{ configured: <comercio conectado> }`.

### 5.5 Checkout (`src/app/checkout/page.tsx`)
- El `useEffect` que pide `configured` adelanta el `vendorId` del comercio abierto: `/api/payments?vendorId=${v.id}`. Si `false` → no se muestra el botón MP.

### 5.6 Webhook multi-tenant (`src/app/api/webhooks/mercadopago/route.ts`)
- Firma con `MP_WEBHOOK_SECRET` (único, de la app) — **no cambia**.
- Si `type === "payment"`:
  1. Lee `body.user_id` (usuario MP que cobró).
  2. Busca `SELECT ... FROM vendors WHERE mp_user_id = $1`.
  3. Si hay match → usa el token descifrado de ese comercio para el `GET /v1/payments/{id}` y sigue el flow actual (orden, stock, push).
  4. Si **no** hay match → fallback al token global (rama suscripciones `portal659_sub_…` al portal).

### 5.7 Tipo + plan
- `types/database.ts`: columnas nuevas en `Vendor`.
- `plans.ts`: feature `mp_payments` queda como está (sigue siendo para "cobrar online", pero ahora sobre la cuenta del comercio).

### 5.8 Landing explain
- En `/privacidad` agrego un párrafo: "Si sos comercio y conectás MP, autorizás a Portal 659 a generar cobros en tu nombre — podés desconectar cuando quieras desde tu panel o desde tu MP."

## 6. AGENTS.md (a agregar tras implementar)

- `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_TOKEN_KEY` nuevas env; `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` se mantienen.
- Tabla `vendors.mp_*`, cifrado, `getVendorMpToken`.
- Webhook routing por `user_id`.

## 7. Setup único para VOS (fuera del código)

1. Crear app en `developers.mercadopago.com.ar` (nombre "Portal 659" por ej.).
2. Activar **OAuth** / "Autenticación" en la app.
3. Setear la **Redirect URL**: `https://www.portal659.com.ar/api/mp/oauth/callback`. (Importante: debe ser *exacta*.)
4. Copiar `Client ID` + `Client Secret` a las env del VPS + `.env.local`.
5. Generar `MP_TOKEN_KEY` (string aleatorio de 32 bytes hex/base64) y agregarlo a las env.
6. Ir a la app → Webhooks: URL `https://www.portal659.com.ar/api/webhooks/mercadopago`, eventos `payments` (es solo validación hacia la app, la ruta ya existe y ya se valida la firma con el secret).

El comercio no hace nada de esto: solo **1 botón** en su panel.

## 8. Testing (antés de producción)

- MP pide datos de **cuentas de vendedor de prueba**: creá una "cuenta test" para comerciante en el panel de MP Developers, conectala, hacé un pago con "checkpoint sandbox" y verificá que cae en la cuenta de test y se dispara el webhook con su `user_id`.
- Probar `disconnect` y efecto en checkout.
- Probar un comercio que no conectó: no aparece MP en su checkout.
- Probar refresh de token (forzar `mp_expires_at` al pasado y ver que `getVendorMpToken` lo renueva).

## 9. Qué NO se hace ahora (para evitar creep)

- No hay API de refunds ni split de pagos.
- No cambia el modelo de suscripciones / cobros al portal.
- No hay panel de admin para "ver tokens" (a propósito).
