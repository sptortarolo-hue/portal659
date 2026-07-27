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

## Despliegue rpido

Ver **[DEPLOYMENT.md](DEPLOYMENT.md)** para instrucciones completas paso a paso.

En resumen:
1. Crear proyecto en Supabase
2. Ejecutar `supabase/migrations/001_init.sql` en el SQL Editor
3. Crear Web Service en Render.com conectando este repo
4. Agregar las variables de entorno de Supabase en Render
5. Listo

## Desarrollo local

```bash
npm install
cp .env.example .env.local
# complet las variables de entorno de Supabase
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
render.yaml     → Configuracin de deploy en Render
```