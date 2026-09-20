#!/bin/sh
# Portal 659 — backup diario self-managed (DB + uploads → Cloudflare R2)
#
# Corre en el HOST como root (cron instalado por deploy.yml: 07:00 UTC = 04:00 AR;
# también corre como snapshot previo a cada deploy). Independiente del host:
# funciona en cualquier VPS con Docker.
#
# - DB:    docker exec portal659-db pg_dump → gzip (valida integridad + completitud)
# - Files: tar del volumen uploads_data (fotos de productos/logos, downloads/)
# - Push:  rclone → R2 (bucket privado; config por env vars, sin archivo de config)
# - Retención: 14 días local, 30 días en R2
#
# Env (del /opt/portal659/.env que escribe el deploy desde GitHub secrets):
#   POSTGRES_USER / POSTGRES_DB (defaults portal659)
#   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT
#   R2_BUCKET (default portal659-backups)
#
# Salida: 0 = OK; 1 = error (queda en cron.log / log del deploy).
# /opt/portal659-backups está FUERA de /opt/portal659: el deploy no lo borra nunca.

set -u

[ "$(id -u)" = "0" ] || { echo "ERROR: backup.sh corre como root"; exit 1; }

BACKUP_ROOT=/opt/portal659-backups
ENV_FILE=/opt/portal659/.env
NOW=$(date -u +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_ROOT/db" "$BACKUP_ROOT/uploads"

envget() {
  [ -f "$ENV_FILE" ] || return 1
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1
}

PGUSER=$(envget POSTGRES_USER); PGUSER=${PGUSER:-portal659}
PGDB=$(envget POSTGRES_DB); PGDB=${PGDB:-portal659}
R2_BUCKET=$(envget R2_BUCKET); R2_BUCKET=${R2_BUCKET:-portal659-backups}

# --- 1. DB -------------------------------------------------------------------
DB_FILE="$BACKUP_ROOT/db/portal659-$NOW.sql.gz"
if docker ps --format '{{.Names}}' | grep -qx 'portal659-db'; then
  echo "[$NOW] pg_dump → $DB_FILE"
  # stderr a errors.log para no ensuciar el dump; si pg_dump corta a la mitad,
  # el stream gzip queda truncado y lo detecta gzip -t.
  docker exec portal659-db pg_dump -U "$PGUSER" -d "$PGDB" 2>>"$BACKUP_ROOT/errors.log" | gzip > "$DB_FILE"
  # Validación triple: no vacío, gzip íntegro, termina con el marcador de dump completo.
  if [ -s "$DB_FILE" ] \
    && gzip -t "$DB_FILE" 2>/dev/null \
    && gunzip -c "$DB_FILE" | tail -n 20 | grep -q 'PostgreSQL database dump complete'; then
    echo "[$NOW] DB OK ($(du -h "$DB_FILE" | cut -f1))"
  else
    echo "[$NOW] ERROR: dump de DB incompleto o vacío — NO se sube a R2 (revisá errors.log)"
    exit 1
  fi
else
  echo "[$NOW] WARNING: portal659-db no corre (¿primer arranque?), skip DB"
  rm -f "$DB_FILE"
fi

# --- 2. Uploads ----------------------------------------------------------------
# El volumen es <proyecto>_uploads_data según el nombre del folder del compose:
# se busca por sufijo para no depender del prefijo.
UPLOADS_FILE="$BACKUP_ROOT/uploads/uploads-$NOW.tar.gz"
VOL=$(docker volume ls --format '{{.Name}}' | grep -E '(^|_)uploads_data$' | head -n 1)
if [ -n "$VOL" ]; then
  echo "[$NOW] tar uploads (volumen $VOL) → $UPLOADS_FILE"
  docker run --rm -v "$VOL":/data:ro -v "$BACKUP_ROOT":/backup alpine:3 \
    tar czf "/backup/uploads/$(basename "$UPLOADS_FILE")" -C /data .
  if [ -s "$UPLOADS_FILE" ] && gzip -t "$UPLOADS_FILE" 2>/dev/null; then
    echo "[$NOW] uploads OK ($(du -h "$UPLOADS_FILE" | cut -f1))"
  else
    echo "[$NOW] ERROR: tar de uploads inválido — NO se sube a R2"
    exit 1
  fi
else
  echo "[$NOW] WARNING: sin volumen uploads_data, skip uploads"
  rm -f "$UPLOADS_FILE"
fi

# --- 3. Push a R2 (offsite) ----------------------------------------------------
R2_AK=$(envget R2_ACCESS_KEY_ID)
R2_SK=$(envget R2_SECRET_ACCESS_KEY)
R2_EP=$(envget R2_ENDPOINT)
if [ -z "$R2_AK" ] || [ -z "$R2_SK" ] || [ -z "$R2_EP" ]; then
  echo "[$NOW] ERROR: credenciales R2 vacías en $ENV_FILE — backup queda local, no sube offsite"
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "[$NOW] rclone no está, instalando..."
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq rclone >/dev/null 2>&1 || true
fi
if ! command -v rclone >/dev/null 2>&1; then
  echo "[$NOW] ERROR: no se pudo instalar rclone — backup queda local, no sube offsite"
  exit 1
fi

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ENDPOINT="$R2_EP"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_AK"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SK"

echo "[$NOW] push → R2:$R2_BUCKET"
rclone copy "$BACKUP_ROOT/db" "R2:$R2_BUCKET/db" --no-traverse >/dev/null 2>>"$BACKUP_ROOT/errors.log" \
  && rclone copy "$BACKUP_ROOT/uploads" "R2:$R2_BUCKET/uploads" --no-traverse >/dev/null 2>>"$BACKUP_ROOT/errors.log" \
  || { echo "[$NOW] ERROR: fallo el push a R2 (copia local queda)"; exit 1; }
echo "[$NOW] push a R2 OK"

# --- 4. Retención ----------------------------------------------------------------
find "$BACKUP_ROOT/db" -name 'portal659-*.sql.gz' -mtime +14 -delete 2>/dev/null || true
find "$BACKUP_ROOT/uploads" -name 'uploads-*.tar.gz' -mtime +14 -delete 2>/dev/null || true
rclone delete "R2:$R2_BUCKET/db" --min-age 30d >/dev/null 2>&1 || true
rclone delete "R2:$R2_BUCKET/uploads" --min-age 30d >/dev/null 2>&1 || true

echo "[$NOW] backup completo (retención: 14 días local, 30 días R2)"
exit 0
