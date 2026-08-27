# AGENTS.md — Portal 659

Portal 659: "El centro comercial de tu barrio" (Sicardi + Garibaldi). Hub multicommerce hiperlocal: gastronomía, comercio/almacén, servicios, moda, salud, varios, mascotas. Cada comercio tiene micrositio `/tienda/[slug]` con QR; contacto directo por WhatsApp; **0% comisión**.

## Stack y comandos

- **Stack**: Next.js (App Router) + React 19 + Supabase (Postgres + RLS + Storage) + Tailwind v4 + shadcn/ui. Node 22.
- **Typecheck**: `npx tsc --noEmit`
- **Build**: `npm run build`
- **Deploy**: push a `master` dispara GitHub Actions "Deploy to VPS" (`appleboy/ssh-action`, `ssh -p 8277`, path `/opt/portal659`, docker compose + nginx, next start en el contenedor). Sitio: `https://www.portal659.com.ar` (Cloudflare).
- **No commitear/pushear salvo que lo pida el usuario.**

## Reglas operativas (aprendidas)

- **Migraciones**: NO aplicar migraciones desde acá (no hay supabase CLI conectada). Las migraciones nuevas se escriben en `supabase/migrations/NNN_*.sql` y el usuario las corre a mano en el SQL editor de Supabase. Recordar avisarle.
- **RLS**: las rutas server usan cliente anon + token del usuario (RLS activa). Para writes que la RLS no permite (ej. `vendor_subscriptions` → 0 políticas de write; `reviews` → sin UPDATE pública; modules de admin; webhook MP) usar `getServiceClient()` (service role). Patrón en `activate`, `admin/comercios`, `webhooks/mercadopago`, `api/vendor/reviews/[id]`.
- **Planes**: tabla `plans` + `plan_id/plan_status/plan_expires_at/trial_ends_at` en vendors + `vendor_subscriptions`. Resolución en `src/lib/plans.ts` (`resolveVendorPlan`, `can("feature")`, `analyticsDays`). Si la tabla `plans` no está migrada en prod, el gating falla.
- **Modelo de precios (Sprint 3)**:
  - Gratuito: $0, todos; 3 productos; sin carrito (CTA WhatsApp).
  - Nivel 1 Pedidos: solo gastronomía, $4.990, 50 productos, carrito + pedidos.
  - Nivel 2 Gestión integral: solo gastronomía, $12.990, ilimitado + POS (Mostrador) + Mesas + Comanda (KDS).
  - No-gastro: solo Gratuito. Sin grandfather: todos arrancan Gratuito.
- **Variables de entorno**: en `.env.local` local; en el VPS se regenera en el deploy (ver `deploy.yml`). `NEXT_PUBLIC_SITE_URL` se usa para sitemap/metadata.
- **Contenido `/barrio`**: tabla `info_items` (categorías transporte/utilidades/horarios/noticias), contenido curado por seed en la migración 028. Clave `(category, title)` idempotente.

## Estado (al 27/08/2026)

### Completados
- **Sprints 1–2**: núcleo multicommerce — verticales, micrositios + QR, home hub por vertical, "La oferta de hoy", más pedidos, share button, resumen pre-WhatsApp, auth por magic link, favoritos, pedidos con checkout, Mercado Pago (preferencias `/api/payments` + webhook que crea pedido/subscripción).
- **Sprint 3** (commit `cf2e425`): suscripciones y planes (backend + UI `/planes`, `/vendor/suscripcion`, dashboard plan banner, locks en Comanda/Stats/Mostrador/Mesas), Mostrador (POS) y Mesas, columna Plan en admin, gating de carrito en ficha pública, badge de plan.
- **Sprint 4** (commit `acd4286`): Info del barrio (`/barrio` + `info_items` + seed), SEO (metadataBase/OG, `sitemap.ts`, `robots.ts`, JSON-LD LocalBusiness + aggregateRating, metadata por tienda), Confianza y reseñas (`reviews.reply/reply_by/replied_at`, API `/api/vendor/reviews[/[id]]`, tab Reseñas con lock, respuestas visibles, badge "Verificado"), Engagement (NotificationBell montada y oculta si anónimo, página `/favoritos` + link en user-menu), Destacados Premier (`vendors.featured`, toggle admin, sección "Destacados del barrio" en home).
- **Fix deploy** (commit `a48d6c7`): deploy sin `docker compose down` (rollout sin downtime) + healthcheck en app + `depends_on: service_healthy` para nginx + `docker image prune -f`. Motivo: host reinició y no había contenedores que auto-levantar → 521. Verificación post-deploy: site 200.

### Pendiente operativo
- Migraciones `025`, `026`, `027`, `028` **sin aplicar** en Supabase de prod (correr en SQL editor). Sin `026` (tabla `plans`) el gating de planes no funciona en prod.
- Reboot test pendiente del VPS (verificar que la web vuelve sola).

## Plan de sprints restantes (del plan original)

> Los siguientes ítems salen del backlog del plan de producto (`docs/plan-multicommerce-portal659.md`, `docs/lanzamiento-portal659.md`). Alcances a confirmar con el usuario antes de implementar (como se hizo en Sprint 4).

### Sprint 5 — Propuesto: Nuevos barrios / multizona (Arana y Correas)
- Reemplazar `ZONE` estático (`src/lib/config.ts`) por barrios dinámicos desde la tabla `neighborhoods` (ya existe con CRUD admin `/api/admin/config/neighborhoods`).
- Selector de barrio en el nav (cookie de zona); home, `/buscar`, `/mapa`, "La oferta de hoy", "Más pedidos", "Destacados" y verticales filtran por zona.
- `vendors.neighborhood` como slug de barrio (hoy es texto): validar/normalizar en registro y onboarding (select de barrios).
- `info_items.zone` (columna + seed de Arana/Correas) y `/barrio` conmutado por zona.
- SEO: sitemap/metadata por zona.
- Alternativas de Sprint 5 si el usuario prefiere otra dirección (elegir una o combinar):
  - **Pagos online pulidos (MP)**: `payment_method` "mercadopago" formalizado en la orden, captura de dirección en el pago, manejo de rechazos, link de pago manual para vendors sin carrito.
  - **Trazabilidad de pedidos por WhatsApp**: los pedidos del CTA WhatsApp (plan Gratuito) generan un link de confirmación que el comercio abre en la app → notificación + seguimiento para el cliente.
  - **Comunidad y contenido**: newsletter "Alerta Vecinal" (alta de email desde `/barrio`), panel admin CRUD de `info_items` (editar contenido sin tocar SQL).

### Sprint 6 — Comunidad, lanzamiento y feedback
- Mailing/recordatorios: emails transaccionales con Resend (estado de pedido, reseñas, recuperación de pedido abandonado) y campaña de bienvenida.
- Campaña de lanzamiento (material de `docs/lanzamiento-portal659.md`): posteos, volantes, stickers con QR, estados de WhatsApp.
- Métricas de lanzamiento (primeras 4 semanas del doc): pedidos/consultas por comercio, vertical que más engancha, % conversión a WhatsApp, % free → plan pago.
- Cerrar deudas de seguridad: rotar `SUPABASE_SERVICE_ROLE_KEY` que quedó commiteada en `setup.ps1`/historial; bloquear `/api/seed` en prod.

### Sprint 7 — App / PWA y optimizaciones
- PWA instalable (manifest ya existe; service worker + offline básico + push).
- Optimización de rendimiento y conversión (fotos, carga, cuellos de botella).
- Multi-comercio avanzado si valida el mercado (pedidos agregados, "combo del barrio", colaboraciones).

## Referencias útiles
- `docs/plan-multicommerce-portal659.md` — plan de producto multicommerce.
- `docs/lanzamiento-portal659.md` — propuesta de valor, marketing, métricas y backlog.
- `docs/PRODUCCION.md` — puesta en producción y roadmap.
- `src/lib/config.ts` — `ZONE`, `VERTICALS`.
- `src/lib/plans.ts` — planes, features, `resolveVendorPlan`.
- `src/lib/supabase.ts` — `getSupabase` (anon), `getServiceClient`, `getAuthSupabase` (en `lib/auth-utils.ts`).
- `supabase/migrations/` — historial de migraciones (números 001-028).