# Despliegue de SeMorfa App

## Requisitos previos
- Cuenta en Supabase (gratuita)
- Cuenta en Render.com (gratuita)
- Repositorio GitHub `sptortarolo-hue/conectaMOS-v2`

## Paso 1: Crear proyecto en Supabase

1. Ingresá a https://supabase.com/dashboard
2. Hacé click en "New project"
3. Nombre del proyecto: `semorfa`
4. Contraseña de la base de datos: elegí una y anotala
5. Esperá a que el proyecto esté listo (1-2 minutos)

## Paso 2: Obtener credenciales de Supabase

1. En el dashboard de Supabase, andá a **Settings** > **API**
2. Copiá estas tres credenciales:
   - **Project URL** (ej: `https://xxxxx.supabase.co`)
   - **anon public** key
   - **service_role** key

## Paso 3: Aplicar las migraciones SQL

Ejecutá en este orden en el **SQL Editor** de Supabase:

1. `supabase/migrations/001_init.sql` — tablas base (profiles, vendors, neighborhoods, categories, products, bookings, quotes, messages)
2. `supabase/migrations/002_gastronomy.sql` — micrositios (slug, address, hours), orders y políticas de gastronomía
3. `supabase/migrations/003_rls_grants.sql` — RLS y grants para anon/authenticated/service_role

> O desde la CLI: `supabase link --project-ref <ref>` y `supabase db push`.

## Paso 4: Configurar Render.com

### Crear el servicio Web

1. Ingresá a https://render.com/dash
2. Hacé click en **"New"** > **"Web Service"**
3. Conectá el repositorio `sptortarolo-hue/conectaMOS-v2`
4. Configurá estas opciones:
   - **Name**: `semorfa-app`
   - **Region**: Oregon (US West)
   - **Branch**: `master`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm run start`
   - **Plan**: Hobby (gratuito)

### Variables de entorno

Agregá las siguientes variables de entorno en el dashboard de Render:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Tu Project URL de Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Tu anon key de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Tu service_role key de Supabase |

### Deploy

5. Hacé click en **"Create Web Service"**
6. Render detecta el `render.yaml` y despliega automáticamente
7. El primer deploy tarda ~2 minutos

## Paso 5: Verificar el deploy

1. Esperá a que Render diga "Live" (verde)
2. Abrí la URL del servicio (ej: `https://semorfa-app.onrender.com`)
3. Probá la página de inicio y un micrositio `/tienda/[slug]`
4. Creá un usuario desde `/login`

## Desarrollo local

```bash
npm install
supabase start
node scripts/seed.mjs
npm run dev
```

La app queda disponible en `http://localhost:3000`.

## Próximos pasos (fase 2)

- Pagos (Mercado Pago)
- Confirmación de pedido desde el WhatsApp del local hacia la app
- Más barrios (Garibaldi, Arana)
- Panel con estadísticas para vendedores
