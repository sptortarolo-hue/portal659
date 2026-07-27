# conectaMOS — Marketplace hiperlocal

Conecta la oferta y la demanda dentro de tu barrio. Productos, servicios, mano de obra y comida en GBA.

## Stack

- **Next.js 16** (App Router + React 19 + TypeScript)
- **Supabase** (PostgreSQL + Auth + Storage + Realtime)
- **Tailwind CSS v4**
- **Mercado Pago** (fase 2)
- **Render.com** (deploy gratuito)

## Barrios cubiertos

- Sicardi
- Garibaldi
- Arana
- Correas

## Despliegue en Render.com

1. Conectá tu GitHub repo en Render
2. Creá los servicios Web + PostgreSQL en el dashboard de Render
3. Configurá las variables de entorno desde `.env.example`
4. Push a `main` despliega automáticamente

## Desarrollo local

```bash
npm install
cp .env.example .env.local
# completá las variables de entorno de Supabase
npm run dev
```

## Estructura del proyecto

```
src/
  app/          → App Router pages (Next.js)
  components/   → UI components + feature components
  lib/          → Supabase client, utilities
  types/        → TypeScript type definitions
supabase/       → Migrations SQL
```