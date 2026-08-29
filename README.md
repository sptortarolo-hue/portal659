# Portal 659 — El centro comercial de tu barrio

Hub multicommerce hiperlocal (Sicardi + Garibaldi; Arana/Correas en configuración). Cada local tiene su micrositio, el cliente arma el pedido sin registrarse y cae directo al WhatsApp del local. **0% comisión**.

## Stack

- **Next.js 16** (App Router + React 19 + TypeScript, Turbopack)
- **PostgreSQL** (self-host, contenedor `postgres:15-alpine`)
- **Auth**: JWT propio (`jose`) + `argon2`, tabla `profiles`
- **Tailwind CSS v4** + shadcn/ui
- **Deploy**: GitHub Actions → VPS (docker compose: app + db + nginx)

> **Importante:** el proyecto **no usa Supabase**. Es PostgreSQL plano con auth propio y storage a disco.

## Zonas (Sprint 5 — multizona)

- **Sicardi y Garibaldi** (zona activa por defecto)
- **Arana y Correas**: definidas en `src/lib/config.ts` con `active: false` (se activan desde ahí).

## Desarrollo local

Requisitos: Docker + Node 20+.

```bash
npm install

# 1. Levantar Postgres con el esquema (Docker)
docker compose up -d db

# 2. Crear .env.local (ver DEPLOYMENT.md para todas las vars)
DATABASE_URL=postgres://portal659:TU_PASS@localhost:5432/portal659
JWT_SECRET=clave-local-de-desarrollo
NEXT_PUBLIC_SITE_URL=http://localhost:3000
UPLOAD_DIR=./uploads

# 3. Seed de datos de prueba (requiere la app corriendo)
npm run dev          # app en http://localhost:3000 (en otra terminal)
node scripts/seed.mjs
```

El esquema inicial se aplica automáticamente en el primer arranque del contenedor `db` desde `supabase/self-host/schema.sql`.

## Despliegue

Ver **[DEPLOYMENT.md](DEPLOYMENT.md)**.

En resumen: push a `master` dispara GitHub Actions "Deploy to VPS" (docker compose con `app` + `db` + `nginx`). Las variables van en los secrets del repo.

## Impresión térmica

Comandas/tickets a impresora EPOS/ESC por Wi-Fi usando un celular Android como puente (relay `services/print-bridge` + app `android/`). Estado actual, arquitectura, deploy y checklist de prueba: **[docs/impresion-termica.md](docs/impresion-termica.md)**.

## Estructura

```
src/
  app/          → App Router pages (micrositios en /tienda/[slug], /perfil, /admin)
  components/   → UI + feature components (brand, nav, cart, offers)
  lib/          → db (pg), auth (JWT), config, zone, plans
supabase/
  self-host/    → schema.sql (esquema canónico), seed-admin.sql, migraciones de app
  migrations/   → historial de migraciones (001-028, folder heredado de Supabase)
scripts/seed.mjs → Seed de datos de demo
```