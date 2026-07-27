# Despliegue de conectaMOS v2

## Requisitos previos
- Cuenta en Supabase (gratuita)
- Cuenta en Render.com (gratuita)
- Cuenta en GitHub
- Repositorio GitHub `sptortarolo-hue/conectaMOS-v2`

## Paso 1: Crear proyecto en Supabase

1. Ingres a https://supabase.com/dashboard
2. Hac click en "Start new project"
3. Seleccin la organizacin
4. Nombre del proyecto: `conecta-mos`
5. Contrasea de la base de datos: eleg una y anotala
6. Espera a que el proyecto est listo (1-2 minutos)

## Paso 2: Obtener credenciales de Supabase

1. En el dashboard de Supabase, and a **Settings** > **API**
2. Copi estas tres credenciales:
   - **Project URL** (ej: `https://xxxxx.supabase.co`)
   - **anon public** key
   - **service_role** key

## Paso 3: Ejecutar la migracin SQL

1. En Supabase, and a **SQL Editor** en el men lateral
2. Hac click en **"New query"**
3. Copi el contenido de `supabase/migrations/001_init.sql`
4. Hac click en **"Run"**

Esto crea las tablas:
- profiles
- vendors
- neighborhoods
- categories
- products
- bookings
- quotes
- messages

## Paso 4: Configurar Render.com

### Crear el servicio Web

1. Ingres a https://render.com/dash
2. Hac click en **"New"** > **"Web Service"**
3. Conect el repositorio `sptortarolo-hue/conectaMOS-v2`
4. Configura estas opciones:
   - **Name**: `conecta-mos`
   - **Region**: Oregon (US West)
   - **Branch**: `master`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm run start`
   - **Plan**: Hobby (gratuito)

### Variables de entorno

Agreg las siguientes variables de entorno en el dashboard de Render:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Tu Project URL de Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Tu anon key de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Tu service_role key de Supabase |

### Deploy

5. Hac click en **"Create Web Service"**
6. Render detectar el `render.yaml` y desplegar automticamente
7. El primer deploy tarda ~2 minutos

## Paso 5: Verificar el deploy

1. Esper a que Render diga "Live" (verde)
2. Abr la URL del servicio (ej: `https://conecta-mos.onrender.com`)
3. Prob la pgina de inicio
4. Cre un usuario desde `/login`

## Desarrollo local

```bash
npm install
cp .env.example .env.local
# Complet las variables con tus credenciales reales de Supabase
npm run dev
```

La app queda disponible en `http://localhost:3000`.

## Prximos pasos (fase 2)

- Integracin con Mercado Pago para pagos
- Sistema de carrito completo
- Chat en tiempo real (Supabase Realtime)
- Perfil de usuario con historial
- Panel de estadsticas para vendedores