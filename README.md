# Portal 659 — El centro comercial de tu barrio

Galería gastronómica hiperlocal. Cada local tiene su micrositio, el cliente arma el pedido sin registrarse y cae directo al WhatsApp del local. 0% comisión.

"Donde las aplicaciones grandes no llegan, nosotros te salvamos la cena."

## Stack

- **Next.js 16** (App Router + React 19 + TypeScript, Turbopack)
- **Supabase** (PostgreSQL + Auth)
- **Tailwind CSS v4**
- **Render.com** (deploy, vía Docker)

## Zona activa (MVP)

- **Sicardi y Garibaldi** (se muestran juntos como una única zona)
- Arana y Correas quedan para más adelante (no se muestran)

## Desarrollo local

Requisitos: Docker Desktop (WSL2), Supabase CLI, Node 20+.

```bash
npm install
supabase start            # arranca API en 127.0.0.1:54321, Studio en 54323
npm run dev               # app en http://localhost:3000
node scripts/seed.mjs     # datos de demo (usuarios + locales + menú + pedidos)
```

`.env.local` debe apuntar al Supabase local (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`).

### Usuarios de prueba

| Rol | Email | Password |
|---|---|---|
| Comprador | comprador@test.com | test123456 |
| Vendedor (María) | vendedor1@test.com | test123456 |
| Vendedor (Rossi) | vendedor2@test.com | test123456 |
| Vendedor (Pizza) | vendedor3@test.com | test123456 |

## Despliegue

Ver **[DEPLOYMENT.md](DEPLOYMENT.md)** para el paso a paso (Supabase remoto + Render).

En resumen:
1. Aplicar migraciones `supabase/migrations/001_init.sql`, `002_gastronomy.sql` y `003_rls_grants.sql` al proyecto remoto
2. Configurar Web Service en Render (`semorfa-app`) con las env vars de Supabase
3. Listo

## Estructura

```
src/
  app/          → App Router pages (micrositios en /tienda/[slug])
  components/   → UI + feature components (brand, nav, cart, offers)
  lib/          → Supabase client, cart, config
supabase/       → Migraciones SQL + config local
scripts/seed.mjs → Seed de datos de demo
render.yaml     → Configuración de deploy en Render
```
