# Despliegue de Portal 659

Portal 659 corre sobre **Postgres plano** (ya no usa Supabase). La base de datos vive en tu
propio VPS, junto a la app y nginx, vía Docker Compose.

## Requisitos previos
- Un VPS con **Ubuntu/Debian**, Docker y Docker Compose instalados (mínimo 1 GB RAM).
- Dominio apuntando al VPS (DNS → IP del VPS) para el sitio.
- Repositorio GitHub `sptortarolo-hue/conectaMOS-v2`.

## Paso 1: Variables de entorno

Creá un archivo `.env` en la raíz del proyecto (o en el VPS). Ejemplo:

```dotenv
# --- Postgres ---
POSTGRES_DB=portal659
POSTGRES_USER=portal659
POSTGRES_PASSWORD=poné-una-contraseña-fuerte

# --- App (runtime) ---
DATABASE_URL=postgres://portal659:poné-una-contraseña-fuerte@db:5432/portal659
JWT_SECRET=generá-una-clave-larga-y-aleatoria

NEXT_PUBLIC_SITE_URL=https://www.tu-dominio.com

# --- Almacenamiento de imágenes ---
UPLOAD_DIR=/app/uploads

# --- Mercado Pago (pagos online) ---
MP_ACCESS_TOKEN=
MP_PUBLIC_KEY=
MP_WEBHOOK_SECRET=

# --- Resend (emails transaccionales) ---
RESEND_API_KEY=
FROM_EMAIL=Portal 659 <noreply@tu-dominio.com>

# --- Upstash Redis (rate limiting en producción) ---
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# --- Google Maps (geolocalización) ---
NEXT_PUBLIC_GOOGLE_MAPS_KEY=
```

> Importante: `DATABASE_URL` usa el host `db` (el nombre del servicio dentro de la red de
> Docker), **no** `localhost`, porque la app y el Postgres corren en contenedores separados.

## Paso 2: Levantar el stack

```bash
docker compose up -d
```

Esto:
1. Crea el contenedor `db` (Postgres 15) y aplica automáticamente el esquema
   `supabase/self-host/schema.sql` en el primer arranque (vía `docker-entrypoint-initdb.d`).
2. Construye y levanta la app (Next.js) en el puerto 3000 (expuesto internamente).
3. Levanta `nginx` en el puerto 80 como proxy.

### Nota sobre el esquema inicial
El esquema solo se aplica si el volumen de datos de Postgres está vacío. Si ya inicializaste
la base, el esquema no se vuelve a ejecutar. Para cambios de esquema posteriores, aplicá los
archivos SQL manualmente o con un cliente (psql) contra la base.

## Paso 3: Crear el usuario administrador

Ejecutá el script desde la máquina donde tengas el proyecto (requiere `DATABASE_URL`):

```bash
set DATABASE_URL=postgres://portal659:TU_PASS@localhost:5432/portal659   # Windows
# export DATABASE_URL=postgres://portal659:TU_PASS@localhost:5432/portal659  # Linux/Mac
node scripts/create-admin-v2.mjs admin@tudominio.com "TuPasswordSegura" "Nombre Admin"
```

> En el VPS podés apuntar a `db` si lo corrés dentro de la red, o usar el puerto mapeado en
> `localhost`. También existe `supabase/self-host/seed-admin.sql` (alternativa manual) que
> requiere que generes el hash de la contraseña con argon2.

El admin entra al panel en `/admin` (login con el email/contraseña creados).

## Paso 4: Verificar

1. Abrí `https://www.tu-dominio.com/api/health` → debe responder `{"status":"ok", "db":true}`.
2. Probá la página de inicio y un micrositio `/tienda/[slug]`.
3. Creá un usuario desde `/register` (crea perfil + comercio).
4. Logueate en `/admin` con el admin creado.

## Despliegue automático (GitHub Actions)

El workflow `.github/workflows/deploy.yml` se dispara al hacer push a `master`. Descarga el
código en el VPS, escribe las variables desde los **secrets** y hace `docker compose up -d --build`.

Secrets requeridos en el repositorio:
- `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`
- `DATABASE_URL`, `JWT_SECRET`, `POSTGRES_PASSWORD`
- `NEXT_PUBLIC_SITE_URL` (o se fija el valor por defecto en el workflow)
- `RESEND_API_KEY`, `FROM_EMAIL`
- `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

## Desarrollo local

```bash
# 1. Levantar Postgres con el esquema (Docker)
docker compose up -d db

# 2. Configurar .env.local
DATABASE_URL=postgres://portal659:TU_PASS@localhost:5432/portal659
JWT_SECRET=clave-local-de-desarrollo
NEXT_PUBLIC_SITE_URL=http://localhost:3000
UPLOAD_DIR=./uploads

# 3. Seed de datos de prueba (solo desarrollo, no en producción)
# Requiere el server corriendo (npm run dev). Delega en GET /api/seed (Postgres).
node scripts/seed.mjs

# 4. Correr la app
npm run dev
```

La app queda disponible en `http://localhost:3000`.

## Arquitectura post-migración
- **Base de datos**: Postgres 15 plano en el VPS (sin RLS ni roles Supabase). La autorización
  se maneja en la capa de API con JWT.
- **Auth**: JWT propio (jose) + hash de contraseñas con argon2id. Cookies `sb-access-token`
  (se mantuvo el nombre para no tocar el frontend).
- **Storage**: las imágenes se guardan en disco (`UPLOAD_DIR`) y se sirven por `/uploads/*`.
- **Realtime**: eliminado. Los pedidos se actualizan por polling (cada 15 s).