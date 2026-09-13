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
  # El archivo vive en el HOST (ej. /opt/portal659), no adentro del contenedor:
  # pasarlo por stdin, o usar -c para un SQL suelto.
  docker exec -i portal659-db psql -U <POSTGRES_USER> -d <POSTGRES_DB> < supabase/self-host/<archivo.sql>
  docker exec -i portal659-db psql -U <POSTGRES_USER> -d <POSTGRES_DB> -c "<SQL>"
  ```
  (usuario/db por defecto `portal659`; ver `POSTGRES_USER`/`POSTGRES_DB`).

## Reglas operativas (aprendidas)

- **Migraciones**: escribirlas como `.sql` nuevo y avisar al usuario para que las corra en el contenedor (ver arriba). No aplicar desde acá.
- **Auth/guard**: `getAuthUser(request)` en `src/lib/auth.ts` devuelve `{ id, email, full_name, role, verified, is_admin }`. Guard de rutas server.
- **isAdmin**: usa `profiles.is_admin` (no `vendors.is_admin`): el admin no necesita tener un comercio. Helper `isAdmin(request)` en `src/lib/admin-utils.ts`.
- **Planes**: tabla `plans` + `plan_id/plan_status/plan_expires_at/trial_ends_at` en `vendors` + `vendor_subscriptions`. Resolución en `src/lib/plans.ts` (`resolveVendorPlan`, `can("feature")`, `analyticsDays`).
- **Modelo de precios (Sprint 3, actualizado Sprint 8)**:
  - Gratuito: $0, gastronomía; carta completa (productos ilimitados) + carrito/checkout + **hasta `max_orders_month` pedidos por mes (default 20)**. Sin analytics.
  - Nivel 1 Pedidos: solo gastronomía, $4.990, pedidos ilimitados + analytics 7 días + gestión de reseñas.
  - Nivel 2 Gestión integral: solo gastronomía, $12.990, ilimitado + POS (Mostrador) + Mesas + Comanda (KDS) + impresión + cobro online.
  - No-gastro: solo Gratuito (sin carrito: contacto). Sin grandfather: todos arrancan Gratuito.
  - El tope de pedidos vive en `plans.max_orders_month` (migración `supabase/self-host/migrate-order-limit.sql`; NULL = ilimitado). Se aplica en `POST /api/orders` (cuenta pedidos `channel='app'` del mes calendario, no cancelados) y se muestra en el panel del comercio (dashboard/`/vendor/suscripcion`) y se configura en `/admin/planes` (precios, `max_products`, `max_orders_month`, descripción). El Gratuito para gastro se resuelve con `FREE_GASTRO_FEATURES` y el tope del plan `gratuito` (configurable por admin); un plan pago vencido cae a ese mismo fallback. Ver `docs/planes-portal659.md`.
  - **Excepción moda**: `MODA_FEATURES` en `src/lib/plans.ts` habilita `cart`+`emits_orders` gratis para `vertical='moda'` (viene de otra parte: la definición de planes pagos para moda —pos, límites, precios concordantes con gastro— quedó pendiente). `can("kds"|"mesas"|"pos"|"printer")` siguen en false para moda.
- **Zonas (Sprint 5)**: `src/lib/zone.ts` + `ZONES`/`ACTIVE_ZONES`/`DEFAULT_ZONE`/`ZONE_COOKIE` en `src/lib/config.ts`. Cookie `portal659-zone`. Activa: `sicardi-garibaldi`; `arana`/`correas` definidas con `active:false`. `info_items.zone` y función con `p_zone` (migrate-sprint5-zone).
- **Perfil de usuario**: tabla `profiles` (`full_name`, `phone`, `whatsapp`, `neighborhood`), separado de los datos del comercio (`vendors`). Página `/perfil`, API `/api/auth/me` (GET/PATCH).
- **Variables de entorno (prod)**: `DATABASE_URL`, `JWT_SECRET`, `NEXT_PUBLIC_SITE_URL`, `UPLOAD_DIR`, `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_TOKEN_KEY`, `RESEND_API_KEY`, `FROM_EMAIL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `NEXT_PUBLIC_GOOGLE_MAPS_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `PRINT_BRIDGE_URL`, `PRINT_BRIDGE_SECRET`. En local `.env.local`.
- **Mercado Pago Multi-Market (OAuth por comercio)**: cada comercio conecta su propia cuenta MP desde su panel (card `MpConnectCard` en los dashboards de venta) y los cobros online caen directo ahí. OAuth: `GET /api/mp/connect` → authorize URL con `state` HMAC (anti-CSRF) → callback `/api/mp/oauth/callback` guarda tokens **cifrados con AES-256-GCM** en `vendors.mp_*` (nunca en plano, nunca en `.env`). Helpers en `src/lib/mp-oauth.ts` (`getVendorMpToken` con auto-refresh; `encryptSecret`/`decryptSecret`). Pagos: `api/payments` requiere `vendorId`, usa el token del comercio (si no está conectado → 409 y el checkout oculta el botón MP consultando `GET /api/payments?vendorId=`). Webhook: routing por `user_id` del payload → busca `vendors.mp_user_id` y usa su token; suscripciones al portal siguen cayendo al `MP_ACCESS_TOKEN` global. **No hay refund API en esta versión** (seguridad: el token solo vale para cobrar, no para devolver guita). Doc: `docs/mp-multimarket-plan.md`. Env nuevas: `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_TOKEN_KEY`. Migración: `supabase/self-host/migrate-mp-oauth.sql`.
- **Llave maestra MP (`MP_ENABLED`)**: on/off global de todo Mercado Pago (`isMpEnabled()` en `src/lib/mp-oauth.ts`). Solo con `MP_ENABLED=1` operan: card de conexión (`MpConnectCard` la oculta consultando `GET /api/mp/status`), `GET /api/mp/connect` + callback OAuth (403/redirect si está apagado), `POST /api/payments` y rama MP de `/api/subscriptions/pay` (cae a transferencia manual). En dev va en `.env.local`; **en prod NO se define hasta tener el OK de MP** (el `deploy.yml` la omite a propósito y lo documenta). Checklist del día del OK: credenciales reales en secrets + Redirect URL whitelisted en la app de MP + `MP_ENABLED=1` en el workflow + aplicar `migrate-mp-oauth.sql` si falta.
- **Impresión térmica**: motor ESC/POS en `src/lib/thermal-printer.ts` (builders → `BufferResult`, `dispatchPrint` rutea modo `server` TCP directo vs `app` por relay). Relay `services/print-bridge` (HTTP :8791 `/push`→WS a la app Android `android/`). Tabla `vendors.print_mode/print_token/last_print*` (migración `supabase/self-host/migrate-print-bridge.sql`, aplicarla con `docker exec -i portal659-db psql -U portal659 -d portal659 -f ...`). Fallback por sistema en `/vendor/imprimir/[id]`.
- **Encabezado de documentos impresos** (`composeStoreHeader` en `src/lib/thermal-printer.ts`): los 5 documentos (ticket, comanda, retiro, precuenta, prueba) imprimen **logo redondo + nombre** como un único bitmap raster (80mm: logo a la izquierda ~30% + nombre a la derecha; 58mm: logo centrado arriba, mismo tamaño, nombre debajo) y líneas de datos (dirección, Tel/WA, IG/FB) en texto. Toggles por línea: `vendors.print_logo/print_address/print_phone/print_social` (migración `supabase/self-host/migrate-ticket-config.sql`). El nombre del local y el pie de página **siempre** se imprimen. Render: `sharp` (recorte circular del logo + binarizado) + `pureimage` (texto en bitmap, fuente `assets/fonts/Roboto-Bold.ttf` Apache-2.0, `FONT_PATH` = `process.cwd()/assets/fonts`; el `Dockerfile` copia `assets/`). Cache en memoria (`headerImageCache`) por `(id, logo_url, store_name, ancho)`; si el logo/archivo/`sharp` falla, vuelve al encabezado de texto actual (nunca rompe la impresión). `createPrinter` fija `setCharacterSet("PC850_MULTILINGUAL")` para tildes/ñ.
- **Cola de impresión (relay)**: si la app no está conectada, `/push` encola el job (Map en memoria, máx 100/token) y responde `{ok:true, queued:true}`; al reconectarse la app recibe los pendientes en orden (FIFO) con ack; reintentos con máx 8 intentos por fallo de impresión. **La cola vive en memoria del relay: un restart del contenedor la vacía.**
- **App Portal Print**: el WebSocket del relay y la impresión TCP ahora viven **EN JAVA** dentro de `PortalPrintService` (OkHttp WebSocket + Socket 9100), NO en la WebView JavaScript. Persiste en segundo plano (`WakeLock` PARTIAL + `WifiLock` FULL_HIGH_PERF + `START_STICKY` + `android:stopWithTask=false`), notificación fija, reconexión con backoff, y `BootReceiver` (`RECEIVE_BOOT_COMPLETED`) que solo arranca si el usuario no lo apagó. La UI (`android/src/main.ts`) queda solo como **configuración + estado**: escribe config en `SharedPreferences` (`saveConfig`), arranca/detiene el servicio (`setActive`) y consulta estado (`status`). Permiso de notificación + exclusión de batería en primer uso. APK firmado en `public/downloads/portal-print.apk` (keystore estable en `C:\Users\IPS\portal659-keystore\portal-print-release.keystore`; credenciales en txt cómodo del mismo folder, no versionado) — rebuild firmado con `android/android/gradlew.bat assembleRelease` (usa `android/android/keystore.properties` y `www/main.js` regenerado vía `npm run build:web` + `npx cap sync android`). Dependencia del plugin: `com.squareup.okhttp3:okhttp:4.12.0`.
- **Agente PC (Windows)**: app Electron en `services/print-agent/` con **ventana de configuración + bandeja del sistema** (reemplaza al agente CMD). `src/main.js` (proceso principal: ventana, bandeja, IPC, autoarranque vía `HKCU\...\Run` sin admin), `src/relay.js` (WebSocket→TCP), `src/renderer/*` (UI). Config en `%APPDATA%\portal-print-agent\agent.config.json`. Build: `npm run build:exe` (electron-builder, target portable) → `dist/portal-print-agent.exe`; el exe **no se versiona** y se publica con `docker cp` al volumen `/app/uploads/downloads/` (link en `dashboard-gastro.tsx` con `?v=` de cache-bust). Legacy headless: `agent.mjs` (sin deps, se usa en `test/e2e.mjs`).
- **Push (Sprint 7)**: tabla `push_subscriptions` (migración `supabase/self-host/migrate-push-subscriptions.sql`), `src/lib/push.ts` (`sendPushToUser`), API `/api/push/config` + `/api/push/subscribe`, cliente `src/components/pwa/push-subscribe.tsx`. Claves VAPID en env. SW `/sw.js` muestra notificaciones y abre el link al hacer clic.
- **Vertical moda (indumentaria)**:
  - **Dashboard**: solo Pedidos + Mostrador (Comanda y Mesas ocultas, desktop y mobile). Mostrador hoy muestra PlanLock hasta definir planes.
  - **Flow del pedido** (con aceptación explícita, estilo Tiendanube/PedidosYa): `new → confirmed (Aceptar/Rechazar) → preparing (Empaquetando) → ready → sent (solo delivery) → completed`. `new → confirmed` agregado a `VALID_TRANSITIONS` (gastro nunca lo emite). Helpers en `src/lib/order-utils.ts`: `nextStatusFor`/`statusLabel`/`flowSteps`/`MODA_STATUS_LABELS` (parámetro `isModa`); `OrderDetailModal` recibe `isModa`. Push al cliente con textos propios en `/api/vendor/orders/[id]` (`customerNotificationText`).
  - **Stock con reserva**: al crear el pedido (`POST /api/orders` y webhook MP) se descuenta stock en la misma tx (variantes `product_variants.stock`, o `products.stock` si `stock_control`); al **cancelar/rechazar se repone**. Ítems llevan `product_id`/`variant_id` (OrderItem + CartItem). Helper `src/lib/stock.ts` (`adjustStockForItems`, `OutOfStockError` → 409). Si se modifican ítems en `new`, se devuelve lo viejo y se reserva lo nuevo. Solo canal `app`.
- **Flow de cocina (`requires_prep`)**: cada producto tiene `products.requires_prep` (default `true`; switch "Requiere elaboración" en el editor del menú gastro). Los pedidos **mostrador/mesa** sin ningún ítem que requiera cocina (bebidas/packs) **no entran al flow de cocina**: no aparecen en el KDS (`comanda-kds.tsx` filtra con `orderNeedsKitchen` de `src/lib/order-utils.ts`), no imprimen comanda y el badge de Comanda no los cuenta. Mostrador pickup sin cocina se cobra y queda `completed` al instante; con cocina queda `preparing`. Delivery de mostrador siempre queda `preparing` (hay que despacharlo). Consumiciones de mesa sin cocina quedan `new` (suman a la cuenta de la mesa y cierran con ella). Pedidos de la **app** no se tocan (default true → siempre cocina).
- **Home (rediseño usuario-primero)**: hero corto con buscador grande (form GET → `/buscar?q=`), chips de anclas, sección **"Abiertos ahora"** (`src/components/home/open-now-section.tsx`, filtra client-side con `isOpenNow` — el server puede estar en otra TZ), categorías linkean a `/buscar?vertical=`, secciones por vertical se ocultan si están vacías, se quitó la sección "Más ofertas", y el CTA **"¿Tenés un comercio? Sumalo gratis"** queda al final de la home (no en el hero).
- **Horarios (config)**: `src/components/dashboard/hours-editor.tsx` renderiza filas compactas en mobile (día abreviado, inputs time con `flex-1 min-w-0`, label "Cerrado" solo en desktop) — ya no se sale de pantalla.
- **WhatsApp en mesa/mostrador**: esos flows no tienen WA del cliente — no hay link ni "Avisar por WhatsApp" en Comanda, lista de pedidos ni detalle, y las transiciones de estado no disparan notificaciones/push al cliente (guard en `orders/[id]` PATCH; `customer_phone` de mesa/mostrador guarda el WA del comercio).
- **Descuento en efectivo consistente**: fórmula única `cashDiscountForItems` en `src/lib/cash-discount.ts` (cliente y servidor — % sobre unidad con modificadores, promos con `cash_discount_excluded` no reciben). Mostrador muestra subtotal/descuento/total **en vivo** según medio de pago; `pos/order` y cierre de mesa (`tables/[id]/close`) recalculan server-side y guardan `cash_pct`/`cash_discount` + total neto. La **precuenta** (pantalla + ticket impreso) muestra `Efectivo (-X%): $Y` — patrón de preticket gastronómico (TOTAL legal + alternativa efectivo).
- **Vista prueba = producción**: sesión de preview (link compartido) puede TODO lo operativo del panel (incl. `/api/print` y `/api/vendor/upload`, que ahora autentican por `vendor` de `getVendorByRequest`, no por `userId`). Solo quedan fuera a propósito: plata/cuenta (suscripciones, MP OAuth, rotación del preview token). `resolveVendorPlan` en preview da `can()=>true`.
- **Mostrador → delivery**: en "Ventas de hoy" (Mostrador), un pedido pickup no finalizado puede convertirse a domicilio (botón 🛵 → teléfono [+ dirección]) vía `PATCH /api/vendor/orders/[id]` con `method:'delivery'` (pone `pickup_number=null`; no suma delivery_fee).
- **Tema**: claro por default (`layout.tsx` script + `theme-provider` default `light`); el toggle de oscuro persiste en `localStorage("portal659-theme")`.
- **Mobile overflow/sticky**: `overflow-x: clip` global en `html/body` (globals.css — red de seguridad anti desborde horizontal; `clip` no rompe sticky). **Barras sticky SIN `backdrop-blur`** (bug de compositing Chrome/WebView Android: la barra "desaparece" durante el scroll — barras del dashboard y Comanda van con fondo sólido). Toasts con `max-w-[calc(100vw-2rem)]` (un `fixed` no lo corta el `overflow-x-clip` de las páginas). En el micrositio, las fichas de producto **con variantes/opciones auto-scrollean al fondo al abrir** (foto ocupaba todo el pliegue y no se veían las opciones — `product-card.tsx` moda + `gastro-product-row.tsx`). En tickets de Comanda, nombre+modificadores envuelven (`min-w-0 flex-1 break-words`, nunca truncar: cocina los necesita completos).
- **Horarios** (`hours-editor.tsx` + `open-hours.ts`): formato `"lun: 09:00-13:00 y 17:00-22:00"` — 2 franjas por día (jornada cortada) + "Copiar a todos" por fila. Parser tolera legacy (`9 am-6 pm`, `lun a vie 9-18`). `isOpenNow()` cliente usa TZ local; `isOpenNowInTz(str, "America/Argentina/Buenos_Aires", at?)` server (el VPS corre UTC).
- **Abierto/Cerrado online**: `vendors.open_override` boolean nullable (migración `supabase/self-host/migrate-open-override.sql`): `null`=seguir horarios, `true`=forzar abierto, `false`=forzar cerrado. Toggle en el header del dashboard (`open-toggle.tsx`). `isStoreOpen(vendor)` (override gana) alimenta badges de micrositio/cards/home y **`POST /api/orders` rechaza con 409 si está cerrado**.
- **Mesas**: el tipo de impresión `precuenta` (motor `thermal-printer.ts` + `POST /api/print`) imprime la cuenta abierta (ítems + total, leyenda "no es comprobante de pago"). UI mobile de mesa en **2 pantallas**: catálogo (buscador+chips sticky) → barra "🧾 Detalle de la mesa" → cuenta (consumiciones, carrito, pago, "Precuenta", "Cobrado y cerrar"). Carrito con `−/+` por línea.
- **Analytics**: `analytics_days=99999` del plan Gestión es "ilimitado"; la ruta capea loops a 366 días y el fetch de reviews a 100 (antes O(100k) colgaba la pestaña). El cliente valida `r.ok && d.today` antes de renderizar (un 401 en JSON crasheaba el dashboard).
- **Pool pg** (`db.ts`): `keepAlive:true` + `keepAliveInitialDelayMillis:10s` + `idleTimeoutMillis:10s` + handler de `error` que descarta (antes se colgaban requests al reusar sockets que el NAT de docker mató → Comanda/Mesas "no se pudo cargar"). Dashboard monta pestañas `comanda/pos/mesas/analytics/reviews` solo cuando se abren (`mountedTabs`).
- **Contenido `/barrio`**: tabla `info_items` (categorías transporte/utilidades/horarios/noticias), curado por seed.
- **Imágenes**: se sirven directo con `<img>` clásico (`src/components/product-image.tsx`), sin `next/image` (el optimizador daba 400 con URLs absolutas same-origin). **Toda foto de uploads se renderiza con `ProductImage`, nunca `<img>` crudo** (logos, galería, buscar, cards, avatar: el crudo no reintenta ni tiene fallback). `ProductImage` reintenta solo (3 intentos con backoff + al volver la red/`online`/pestaña visible), sincroniza el estado real del `<img>` tras hidratar (`img.complete`/`naturalWidth` + guard `src===currentSrc`: la foto del SSR puede cargar ANTES de que React conecte `onLoad` y quedaba invisible en `opacity-0` — causa raíz de la carga aleatoria de sep-2026) y el fallback es clicable (reintenta sin F5); el fallo definitivo se loguea en consola y se reporta a `POST /api/img-error` (rate-limit en memoria, cae en `docker logs` como `[API:img-client]`). Subidas: `POST /api/vendor/upload` guarda en `UPLOAD_DIR` con nombre único, achica a 1200px/q80 con `sharp`, URL absoluta vía `getSiteUrl()`; **HEIC y SVG se rechazan** (el navegador no renderiza HEIC servido como octet-stream). Servido: `src/app/uploads/[...path]/route.ts` con `immutable` 1 año; 404/403 con `no-store`. **SW (`public/sw.js`) hace bypass total de `/uploads/*` (ni los intercepta) y NO cachea navegaciones/HTML** (solo push + offline.html + estáticos): un HTML cacheado pre-deploy referencia chunks rotados y el SW mediando fotos con 503 sintéticos fueron la causa de "imágenes que solo aparecen al refrescar" (sep-2026). Al cambiar la estrategia del SW, bumpear `CACHE_NAME` (v13 actual) para purgar cachés viejas en clientes.

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
- Aplicar `supabase/self-host/migrate-order-limit.sql` (columna `plans.max_orders_month` + gratuito carta completa con 20 pedidos/mes — nuevo modelo de planes Sprint 8, ver `docs/planes-portal659.md`).
- Aplicar `supabase/self-host/migrate-requires-prep.sql` (columna `products.requires_prep`).
- Aplicar `supabase/self-host/migrate-mp-oauth.sql` (columnas `vendors.mp_*` para MP multi-market).
- En MP Developers: crear app con OAuth, Redirect URL `https://www.portal659.com.ar/api/mp/oauth/callback`, agregar `MP_CLIENT_ID` + `MP_CLIENT_SECRET` + `MP_TOKEN_KEY` (generada) a env/VPS (ver `docs/mp-multimarket-plan.md`).
- Aplicar `supabase/self-host/migrate-open-override.sql` (columna `vendors.open_override` — toggle Abierto/Cerrado del comercio).
- Aplicar `supabase/self-host/migrate-ticket-config.sql` (toggles de encabezado impreso: `vendors.print_logo/print_address/print_phone/print_social` — sin esto los tickets salen con todo activado por defecto igual, pero conviene correrla antes de tocar esos switches en el dashboard).
- Aplicar `supabase/self-host/migrate-subscription-payments.sql` (campos de pago en `vendor_subscriptions`: `payment_method/amount/paid_at` — panel `/admin/suscripciones`).
- Aplicar `supabase/self-host/migrate-order-track-token.sql` (columna `orders.track_token` — link de seguimiento público `/seguimiento/[token]` y cuenta comprador).
- Aplicar `supabase/self-host/migrate-recipes.sql` (módulo Recetas/escandallo gastro: `ingredients` + `recipes` + `recipe_items` + flag `recipes` en plan `gestion` — tab Recetas del dashboard, plan Gestión integral).
- Aplicar `supabase/self-host/migrate-preview.sql` (modo prueba compartible: `vendors.preview_token/preview_token_expires_at/publish_requested_at` + `orders.is_preview` — preview de micrositio con pedidos de prueba y publicación con aprobación del admin).
- Aplicar `supabase/self-host/migrate-orders-updated-at.sql` (columna `orders.updated_at` + trigger que la actualiza en cada UPDATE — el SSE del dashboard filtra por `updated_at`; sin esto no llegan eventos).
- Aplicar `supabase/self-host/migrate-purchases.sql` (módulo Compras: `suppliers` + `purchases` + `purchase_items` — sub-vista Compras del tab Recetas).
- Aplicar `supabase/self-host/migrate-recipe-links.sql` (receta compartida porción/entera: `product_recipe_links` + umbrales `vendors.food_cost_warn/food_cost_bad` — presentaciones en el editor y semáforo editable).
- Aplicar `supabase/self-host/migrate-online-toggle.sql` (opt-out venta online: `vendors.accepts_online_orders` — toggle en dashboards gastro/moda, badges/filtro online, gate de POST orders).
- Aplicar `supabase/self-host/migrate-cash-discount.sql` (descuento en efectivo: `vendors.cash_discount_pct` + `products.cash_discount_excluded` + `orders.cash_discount/cash_pct` — doble precio en micrositio, descuento al cobrar en efectivo, detalle en ticket/WhatsApp).
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
- **Planes para moda** (definir con el usuario): Habilitar `pos` (Mostrador) impresión y límites de productos; precios concordantes con gastronomía. Hoy moda tiene cart gratis vía `MODA_FEATURES` y el tab Mostrador muestra PlanLock. También: cancelación con motivo/`cancelled_by`, expiración de transferencias no confirmadas (estilo "Pago vencido" de Tiendanube).

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