# Portal 659 — Checklist Producción

Stack real: **Next.js + PostgreSQL self-host (Docker) + nginx**, desplegado por **GitHub Actions a un VPS**. No usa Supabase ni Vercel.

## 1. Infraestructura

- [ ] VPS (Ubuntu/Debian, mínimo 1 GB RAM) con Docker + Docker Compose.
- [ ] Dominio apuntando al VPS (DNS → IP). HTTPS por Cloudflare (el contenedor nginx escucha en el puerto 80).
- [ ] Repositorio GitHub `sptortarolo-hue/portal659`.

### Contenedores (docker-compose.yml)
| Servicio | Imagen | Rol |
|---|---|---|
| `app` | portal659-app (Next.js) | App en puerto 3000 (interno) |
| `db` | postgres:15-alpine | PostgreSQL, esquema en `supabase/self-host/schema.sql` |
| `nginx` | nginx:alpine | Proxy, puerto 80 |

## 2. Variables de entorno (VPS `.env` + secrets de GitHub Actions)

```dotenv
# Postgres
POSTGRES_DB=portal659
POSTGRES_USER=portal659
POSTGRES_PASSWORD=poné-una-contraseña-fuerte

# App (runtime)
DATABASE_URL=postgres://portal659:TU_PASS@db:5432/portal659   # host = db (red Docker)
JWT_SECRET=generá-una-clave-larga-y-aleatoria
NEXT_PUBLIC_SITE_URL=https://www.portal659.com.ar
UPLOAD_DIR=/app/uploads

# Mercado Pago
MP_ACCESS_TOKEN=
MP_PUBLIC_KEY=
MP_WEBHOOK_SECRET=

# Resend
RESEND_API_KEY=
FROM_EMAIL=Portal 659 <noreply@tu-dominio.com>

# Upstash Redis (rate limiting)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Google Maps
NEXT_PUBLIC_GOOGLE_MAPS_KEY=
```

En local van en `.env.local`; en el VPS se regeneran desde los secrets en el deploy (ver `deploy.yml`).

## 3. Deploy (GitHub Actions)

- Push a `master` → workflow `Deploy to VPS` (`appleboy/ssh-action`, puerto 8277).
- Descarga el código en `/opt/portal659`, escribe el `.env` desde los secrets y hace `docker compose up -d --build`.
- Sin downtime + healthcheck (`/api/health`): si un contenedor cae, `restart: unless-stopped` lo levanta; si el host reinicia, los contenedores existentes vuelven solos.

### Secrets requeridos
`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `DATABASE_URL`, `JWT_SECRET`, `POSTGRES_PASSWORD`, `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`, `FROM_EMAIL`, `MP_*`, `UPSTASH_REDIS_*`, `NEXT_PUBLIC_GOOGLE_MAPS_KEY`.

## 4. Usuario administrador

```bash
docker compose up -d db
# con DATABASE_URL apuntando a localhost:
node scripts/create-admin-v2.mjs admin@tudominio.com "TuPasswordSegura" "Nombre Admin"
# o vía SQL en el contenedor:
docker exec -i portal659-db psql -U portal659 -d portal659 -f supabase/self-host/seed-admin.sql
```

`isAdmin` usa `profiles.is_admin`. El admin entra en `/admin`.

## 5. Verificación post-deploy

- [ ] `https://www.portal659.com.ar/api/health` → `{"status":"ok","db":true}`
- [ ] Home, `/login`, `/register`, `/buscar`, `/tienda/[slug]`, `/checkout`, `/mis-pedidos`, `/vendor/dashboard`, `/admin`, `/perfil`
- [ ] Login/logout desde el menú (☰) funciona
- [ ] Mi perfil edita nombre/teléfono/WhatsApp/barrio

## 6. Monitoreo y logs

- Logs de app: `docker compose logs -f app`
- Logs de Postgres: `docker compose logs -f db`
- Healthcheck configurado en `app` (wget a `/api/health`); nginx arranca solo si `app` está healthy.

## 7. Backup

```bash
docker exec portal659-db pg_dump -U portal659 -d portal659 > backup.sql
# o dentro del contenedor db
docker exec portal659-db pg_dump -U portal659 portal659 > /backups/portal659-$(date +%F).sql
```

## 8. Costos estimados

| Servicio | Costo |
|---|---|
| VPS (1 GB RAM) | ~US$5-6/mes |
| Cloudflare (DNS/CDN) | Gratis |
| Mercado Pago | % por transacción |
| Resend | Free (100 emails/día) |
| Dominio | ~US$10/año |

## 9. Roadmap

- [ ] Tests E2E (Playwright)
- [ ] Error tracking (Sentry)
- [ ] Push notifications (web / PWA)
- [ ] Más zonas activas (Arana, Correas)