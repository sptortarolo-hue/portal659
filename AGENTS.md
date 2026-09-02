# AGENTS.md — Portal 659

Portal 659: "El centro comercial de tu barrio". Hub multicommerce hiperlocal (Sicardi y Garibaldi; multizona Arana/Correas en configuración). Cada comercio tiene micrositio `/tienda/[slug]` con QR; contacto directo por WhatsApp; **0% comisión**.

## Stack y comandos

- **Stack**: Next.js (App Router) + React 19 + **PostgreSQL** (contenedor `portal659-db`, `postgres:15-alpine`) + Tailwind v4 + shadcn/ui. Node 22.
- **Auth**: **JWT propio** (`jose`) + **argon2**, tabla `profiles`, secret `JWT_SECRET`. Cookies `sb-access-token`/`sb-refresh-token` (nombres heredados de Supabase, pero es JWT propio). Helpers en `src/lib/auth.ts`.
- **Datos**: `src/lib/db.ts` (pool `pg` + `DATABASE_URL`: `query`/`queryOne`/`queryMany`/`withTransaction`). **No existe Supabase**: no hay `getSupabase`/`getServiceClient`/RLS.
- **Storage**: a disco (`UPLOAD_DIR`, volumen `uploads_data`), no Supabase Storage.
- **Typecheck**: `npx tsc --noEmit`
- **Build**: `npm run build`
- **Deploy**: push a `master` dispara GitHub Actions "Deploy to VPS" (ssh -p 8277, path `/opt/portal659`, docker compose con `app`+`db`+`nginx`, `next start`). Sitio: `https://www.portal659.com.ar` (Cloudflare).
- **No commitear/pushear salvo que lo pida el usuario.**

## Base de datos (PostgreSQL self-host)

- Esquema canónico: `supabase/self-host/schema.sql` (se monta en `docker-entrypoint-initdb.d` en el primer arranque del contenedor `db`).
- `supabase/migrations/001-028` son historial (folder heredado de la época de Supabase).
- Helpers de aplicación: `supabase/self-host/seed-admin.sql` (crear admin) y `supabase/self-host/migrate-sprint5-zone.sql`.
- **Aplicar SQL**: NO hay SQL editor de Supabase. Se corre contra el contenedor:
  ```
  docker exec -i portal659-db psql -U <POSTGRES_USER> -d <POSTGRES_DB> -f <archivo.sql>
  # o para un fragmento:
  docker exec -i portal659-db psql -U <POSTGRES_USER> -d <POSTGRES_DB> -c "<SQL>"
  ```
  (usuario/db por defecto `portal659`; ver `POSTGRES_USER`/`POSTGRES_DB`).

## Reglas operativas (aprendidas)

- **Migraciones**: escribirlas como `.sql` nuevo y avisar al usuario para que las corra en el contenedor (ver arriba). No aplicar desde acá.
- **Auth/guard**: `getAuthUser(request)` en `src/lib/auth.ts` devuelve `{ id, email, full_name, role, verified, is_admin }`. Guard de rutas server.
- **isAdmin**: usa `profiles.is_admin` (no `vendors.is_admin`): el admin no necesita tener un comercio. Helper `isAdmin(request)` en `src/lib/admin-utils.ts`.
- **Planes**: tabla `plans` + `plan_id/plan_status/plan_expires_at/trial_ends_at` en `vendors` + `vendor_subscriptions`. Resolución en `src/lib/plans.ts` (`resolveVendorPlan`, `can("feature")`, `analyticsDays`).
- **Modelo de precios (Sprint 3)**:
  - Gratuito: $0, todos; 3 productos; sin carrito (CTA WhatsApp).
  - Nivel 1 Pedidos: solo gastronomía, $4.990, 50 productos, carrito + pedidos.
  - Nivel 2 Gestión integral: solo gastronomía, $12.990, ilimitado + POS (Mostrador) + Mesas + Comanda (KDS).
  - No-gastro: solo Gratuito. Sin grandfather: todos arrancan Gratuito.
- **Zonas (Sprint 5)**: `src/lib/zone.ts` + `ZONES`/`ACTIVE_ZONES`/`DEFAULT_ZONE`/`ZONE_COOKIE` en `src/lib/config.ts`. Cookie `portal659-zone`. Activa: `sicardi-garibaldi`; `arana`/`correas` definidas con `active:false`. `info_items.zone` y función con `p_zone` (migrate-sprint5-zone).
- **Perfil de usuario**: tabla `profiles` (`full_name`, `phone`, `whatsapp`, `neighborhood`), separado de los datos del comercio (`vendors`). Página `/perfil`, API `/api/auth/me` (GET/PATCH).
- **Variables de entorno (prod)**: `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_SITE_URL`, `UPLOAD_DIR`, `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`, `RESEND_API_KEY`, `FROM_EMAIL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `NEXT_PUBLIC_GOOGLE_MAPS_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `PRINT_BRIDGE_URL`, `PRINT_BRIDGE_SECRET`. En local `.env.local`.
- **Impresión térmica**: motor ESC/POS en `src/lib/thermal-printer.ts` (builders → `BufferResult`, `dispatchPrint` rutea modo `server` TCP directo vs `app` por relay). Relay `services/print-bridge` (HTTP :8791 `/push`→WS a la app Android `android/`). Tabla `vendors.print_mode/print_token/last_print*` (migración `supabase/self-host/migrate-print-bridge.sql`, aplicarla con `docker exec -i portal659-db psql -U portal659 -d portal659 -f ...`). Fallback por sistema en `/vendor/imprimir/[id]`.
- **Cola de impresión (relay)**: si la app no está conectada, `/push` encola el job (Map en memoria, máx 100/token) y responde `{ok:true, queued:true}`; al reconectarse la app recibe los pendientes en orden (FIFO) con ack; reintentos con máx 8 intentos por fallo de impresión. **La cola vive en memoria del relay: un restart del contenedor la vacía.**
- **App Portal Print**: backoff exponencial de reconexión (1s→30s) + guardián cada 10s si está desconectada + `PortalPrintService` (foreground service con notificación fija, evita que Android mate el proceso; `keepAwake` lo levanta). APK firmado se sirve en `public/downloads/portal-print.apk` (descargable desde la sección Impresora del dashboard). Keystore estable en `C:\Users\IPS\portal659-keystore\portal-print-release.keystore` (credenciales en el txt de ese folder, no versionado). Para recompilar: `node` scripts en `android/README.md`.
- **Push (Sprint 7)**: tabla `push_subscriptions` (migración `supabase/self-host/migrate-push-subscriptions.sql`), `src/lib/push.ts` (`sendPushToUser`), API `/api/push/config` + `/api/push/subscribe`, cliente `src/components/pwa/push-subscribe.tsx`. Claves VAPID en env. SW `/sw.js` muestra notificaciones y abre el link al hacer clic.
- **Contenido `/barrio`**: tabla `info_items` (categorías transporte/utilidades/horarios/noticias), curado por seed.

## Estado

### Completados
- **Sprints 1–4**: núcleo multicommerce, auth (magic link), favoritos, pedidos con checkout, Mercado Pago, suscripciones/planes, POS/Mesas, info del barrio, SEO, reseñas con respuesta + badge verificado, notificaciones + favoritos, destacados.
- **Migración a PostgreSQL** (commit `3d26827`): Supabase → Postgres plano (JWT+argon2, storage a disco, sin realtime). **El código ya no usa Supabase.**
- **Sprint 5 — Multizona** (commits `9678200`, `be2e7e4`, `812144b`, `4e2940d`): selector de barrio (cookie de zona), filtrado por zona en home/buscar/mapa/barrio/más pedidos, `info_items.zone`, `isAdmin` en `profiles.is_admin`.
- **Gestión de usuarios**: página `/perfil` + `PATCH /api/auth/me` (editar nombre/teléfono/WhatsApp/barrio), `user-menu` distingue sesión y muestra **Mi perfil** + **Cerrar sesión**; login/register si está anónimo.
- **Fix deploy** (commit `a48d6c7`): deploy sin downtime + healthcheck + auto-recuperación tras reboot.
- **Sprint 6** (commit `0cd6496`): emails con Resend (bienvenida al registrarse, reseña al completar pedido), métricas de lanzamiento (`/admin/metricas` + `/api/admin/metrics`), material de campaña (`docs/campana-lanzamiento.md`), deploy manual (`workflow_dispatch`).
- **Sprint 7 — App/PWA**: instalable (íconos PNG 192/512 + maskable + apple en `public/icons/`, manifest y meta tags), notificaciones push (tabla `push_subscriptions`, `sendPushToUser`, suscripción automática al loguear, push en estado de pedido y pago MP), optimización de rendimiento (lazy-load de imágenes en tarjetas y micrositio). Generador de íconos: `scripts/generate-icons.mjs`. **Multi-comercio avanzado diferido** (pedidos agregados/"combo del barrio") hasta validar el mercado.

### Pendiente operativo
- Cargar valores reales de `DATABASE_URL`/`JWT_SECRET`/`POSTGRES_*`/`MP_*`/`UPSTASH_*`/`NEXT_PUBLIC_GOOGLE_MAPS_KEY` donde corresponda (env del VPS o `.env.local`).
- Aplicar `supabase/self-host/migrate-sprint5-zone.sql` si la zona del Sprint 5 aún no está en la DB del contenedor.
- Aplicar `supabase/self-host/migrate-push-subscriptions.sql` (tabla `push_subscriptions` del Sprint 7) contra el contenedor.
- Aplicar `supabase/self-host/migrate-print-bridge.sql` (impresión térmica: `vendors.print_mode/print_token/last_print*`).
- Cargar secrets `VAPID_*`, `PRINT_BRIDGE_SECRET` y `RESEND_API_KEY`/`FROM_EMAIL` en GitHub para que el deploy las escriba al `.env`.
- Compilar el APK de Portal Print (Android): ver `android/README.md` (requiere Android SDK/JDK 17).
- Reboot test del VPS (verificar que la web vuelve sola).

## App Android para Play Store (TWA)

- Enfoque: **TWA (Trusted Web Activity)** vía Bubblewrap. Envuelve la PWA de `www.portal659.com.ar`; reutiliza auth JWT, zona (cookie), push web y Mercado Pago sin cambios. Misma app para clientes y panel vendor.
- Proyecto: `portal659-twa/` (`twa-manifest.json` + proyecto Android generado). **No** confundir con `android/` (app de impresión Portal Print).
- AppId `ar.portal659.app`, nombre "Portal 659", `startUrl` `/`, compileSdk/target 36, minSdk 21.
- **Digital Asset Links**: `public/.well-known/assetlinks.json` ya creado con el SHA-256 de la **upload key**. ⚠️ Si se habilita **Play App Signing**, Google re-firma con su propia key: reemplazar el fingerprint por el SHA-256 del "App signing key certificate" de Play Console (Setup → App signing) antes de verificar con Digital Asset Links.
- **Keystore (upload key)**: `C:\Users\IPS\portal659-keystore\portal659-release.keystore` (alias `portal659`), credenciales en `keystore-credentials.txt` del mismo folder. **No se versiona**; respaldarla: perderla impide actualizar la app.
- **Requisitos de build en la máquina**: JDK 17 (Bubblewrap lo exige; se instaló Temurin 17 y un junction `C:\Users\IPS\jdk17` → ruta sin espacios, porque Bubblewrap arma comandos con shell y rutas con espacios rompen el sign). SDK Android en `C:\Users\IPS\AppData\Local\Android\Sdk` con `build-tools;36.1.0` (exigido por Bubblewrap) + junction `tools` → `cmdline-tools\latest` (validación vieja del SDK).
- Config de Bubblewrap: `C:\Users\IPS\.bubblewrap\config.json` (`jdkPath`, `androidSdkPath`).
- **Cómo regenerar/compilar**:
  ```
  # 1) regenerar el proyecto Android desde twa-manifest.json (no interactivo)
  node _generate-twa.cjs            # dentro de portal659-twa/
  # 2) compilar AAB + APK firmados (usa passwords de env, no pregunta)
  $env:BUBBLEWRAP_KEYSTORE_PASSWORD="..."; $env:BUBBLEWRAP_KEY_PASSWORD="..."
  bubblewrap build                  # dentro de portal659-twa/
  ```
  Salidas: `app-release-bundle.aab` (subir a Play) y `app-release-signed.apk` (instalar directo).
- `bubblewrap init` es interactivo y falla en shells sin TTY; por eso se genera el proyecto con `_generate-twa.cjs` (llama a `@bubblewrap/core` `TwaGenerator`) y el build usa las env vars de password.

## Plan de sprints restantes (del plan original)

> Alcances a confirmar con el usuario antes de implementar (como se hizo en Sprints 4 y 5).

### Sprint 6 — Comunidad, lanzamiento y feedback
- Mailing/recordatorios con Resend (estado de pedido, reseñas, pedido abandonado) y campaña de bienvenida.
- Campaña de lanzamiento (material de `docs/lanzamiento-portal659.md`): posteos, volantes, stickers con QR, estados de WhatsApp.
- Métricas de lanzamiento (primeras 4 semanas): pedidos/consultas por comercio, vertical que más engancha, % conversión a WhatsApp, % free → plan pago.
- Deudas de seguridad: bloquear `/api/seed` en prod; revisar secretos commiteados en historial.

### Sprint 7 — App / PWA y optimizaciones
- PWA instalable (íconos PNG, manifest, SW + offline + push). **Hecho.**
- Optimización de rendimiento y conversión (fotos, carga). **Hecho (lazy-load).**
- **Multi-comercio avanzado: diferido** hasta validar el mercado (pedidos agregados, "combo del barrio", colaboraciones).

### Ideas del backlog (a priorizar)
- Pagos online pulidos (MP): `payment_method` "mercadopago" formalizado, dirección en el pago, rechazos, link de pago manual para vendors sin carrito.
- Trazabilidad de pedidos por WhatsApp (plan Gratuito): link de confirmación + seguimiento.
- Comunidad/contenido: newsletter "Alerta Vecinal", panel admin CRUD de `info_items`.

## Referencias útiles
- `docs/plan-multicommerce-portal659.md` — plan de producto multicommerce.
- `docs/lanzamiento-portal659.md` — propuesta de valor, marketing, métricas y backlog.
- `docs/PRODUCCION.md` — puesta en producción y roadmap.
- `src/lib/config.ts` — `ZONES`, `ACTIVE_ZONES`, `DEFAULT_ZONE`, `VERTICALS`.
- `src/lib/zone.ts` — zona activa (cookie).
- `src/lib/plans.ts` — planes, features, `resolveVendorPlan`.
- `src/lib/db.ts` — acceso a datos (pool `pg`).
- `src/lib/auth.ts` — JWT propio, `getAuthUser`.
- `supabase/self-host/schema.sql` — esquema canónico de la DB.