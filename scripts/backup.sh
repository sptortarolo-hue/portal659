#!/bin/sh
# Portal 659 — backup diario self-managed (DB + uploads → Cloudflare R2)
#
# Corre en el HOST como root (cron instalado por deploy.yml: 07:00 UTC = 04:00 AR;
# también corre como snapshot previo a cada deploy). Independiente del host:
# funciona en cualquier VPS con Docker.
#
# - DB:    docker exec portal659-db pg_dump → gzip (valida integridad + completitud)
# - Files: tar del volumen uploads_data (fotos de productos/logos; se excluye
#   downloads/ — el .zip del agente y APKs son reconstruibles y pesaban ~100MB
#   por snapshot) → R2 (bucket privado; config por env vars, sin archivo)
# - Push:  rclone → R2 (bucket privado; config por env vars, sin archivo de config)
# - Retención: 7 días local (conservando siempre las 3 copias más nuevas),
#   30 días en R2. La limpieza local corre SIEMPRE aunque falle el push
#   (disco VPS chico: la acumulación por push fallido ya lo llenó una vez
#   y volteó Postgres). cron.log se rota a 500 líneas por run.
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

# Rotación de cron.log: el cron hace >> sin límite (el run fallido del 22-sep
# dejó páginas de 403). Se reescribe el MISMO inode (cat >) para no romper el
# fd O_APPEND que el cron ya tiene abierto; va antes de cualquier echo.
LOG_FILE="$BACKUP_ROOT/cron.log"
if [ -f "$LOG_FILE" ]; then
  tail -n 500 "$LOG_FILE" > "$LOG_FILE.tmp" 2>/dev/null \
    && cat "$LOG_FILE.tmp" > "$LOG_FILE" 2>/dev/null \
    && rm -f "$LOG_FILE.tmp" 2>/dev/null || true
fi

envget() {
  [ -f "$ENV_FILE" ] || return 1
  sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1
}

PGUSER=$(envget POSTGRES_USER); PGUSER=${PGUSER:-portal659}
PGDB=$(envget POSTGRES_DB); PGDB=${PGDB:-portal659}
R2_BUCKET=$(envget R2_BUCKET); R2_BUCKET=${R2_BUCKET:-portal659-backups}

# Limpieza local resiliente: borra archivos con más de $3 días PERO conserva
# siempre los $4 más nuevos (resguardo si R2 lleva caído varios días).
# Corre SIEMPRE (incluso si el push falló): la causa del backlog de 146
# archivos fue que la limpieza estaba después del exit 1 del push.
prune_local() {
  _dir=$1; _pat=$2; _days=$3; _keep=$4
  _keep_list=$(ls -t "$_dir"/$_pat 2>/dev/null | head -n "$_keep")
  find "$_dir" -maxdepth 1 -name "$_pat" -mtime +"$_days" 2>/dev/null | while IFS= read -r _f; do
    if printf '%s\n' "$_keep_list" | grep -qxF "$_f"; then
      : # entre las más nuevas: se conserva
    else
      rm -f "$_f"
    fi
  done
}

# --- 1. DB -------------------------------------------------------------------
DB_FILE="$BACKUP_ROOT/db/portal659-$NOW.sql.gz"
if docker ps --format '{{.Names}}' | grep -qx 'portal659-db'; then
  # Esperar que Postgres acepte conexiones (tras un restart el contenedor
  # figura "up" pero sigue en recovery; sin esto pg_dump falla y ensucia
  # errors.log con un falso error — visto 24-sep-2026).
  READY=no
  for _i in $(seq 1 30); do
    if docker exec portal659-db pg_isready -U "$PGUSER" -d "$PGDB" >/dev/null 2>&1; then
      READY=yes
      break
    fi
    sleep 2
  done
  if [ "$READY" != "yes" ]; then
    echo "[$NOW] ERROR: portal659-db no acepta conexiones tras 60s — skip DB (revisá el contenedor)"
    rm -f "$DB_FILE"
  else
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
  # Se excluye downloads/ (agente .zip/APKs reconstruibles): ahorra ~100MB
  # por snapshot y no afecta el restore (las fotos van igual).
  docker run --rm -v "$VOL":/data:ro -v "$BACKUP_ROOT":/backup alpine:3 \
    tar czf "/backup/uploads/$(basename "$UPLOADS_FILE")" --exclude='./downloads' -C /data .
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
# stderr de rclone sale inline al log (para diagnóstico); stdout se descarta.
# Sin exit acá: la limpieza local corre SIEMPRE (ver paso 5).
PUSH_OK=yes
rclone copy "$BACKUP_ROOT/db" "R2:$R2_BUCKET/db" --no-traverse 2>&1 >/dev/null \
  && rclone copy "$BACKUP_ROOT/uploads" "R2:$R2_BUCKET/uploads" --no-traverse 2>&1 >/dev/null \
  || PUSH_OK=no
if [ "$PUSH_OK" = "yes" ]; then
  echo "[$NOW] push a R2 OK"
else
  echo "[$NOW] ERROR: fallo el push a R2 (copia local queda)"
fi

# --- 4. Verificación post-subida (solo si el push anduvo) ----------------------
VERIFY_OK=yes
if [ "$PUSH_OK" = "yes" ]; then
  R2_DB_COUNT=$(rclone ls "R2:$R2_BUCKET/db" --max-depth 1 2>/dev/null | wc -l | tr -d ' ')
  R2_UP_COUNT=$(rclone ls "R2:$R2_BUCKET/uploads" --max-depth 1 2>/dev/null | wc -l | tr -d ' ')
  if [ "$R2_DB_COUNT" = "0" ] || [ "$R2_UP_COUNT" = "0" ]; then
    echo "[$NOW] CRITICAL: R2 quedó vacío después del push (db=$R2_DB_COUNT uploads=$R2_UP_COUNT) — reintentando"
    if rclone copy "$BACKUP_ROOT/db" "R2:$R2_BUCKET/db" --no-traverse 2>&1 >/dev/null \
      && rclone copy "$BACKUP_ROOT/uploads" "R2:$R2_BUCKET/uploads" --no-traverse 2>&1 >/dev/null; then
      R2_DB_COUNT=$(rclone ls "R2:$R2_BUCKET/db" --max-depth 1 2>/dev/null | wc -l | tr -d ' ')
      R2_UP_COUNT=$(rclone ls "R2:$R2_BUCKET/uploads" --max-depth 1 2>/dev/null | wc -l | tr -d ' ')
    fi
    if [ "$R2_DB_COUNT" = "0" ] || [ "$R2_UP_COUNT" = "0" ]; then
      echo "[$NOW] CRITICAL: R2 sigue vacío tras re-intento (db=$R2_DB_COUNT uploads=$R2_UP_COUNT)"
      VERIFY_OK=no
    fi
  fi
  if [ "$VERIFY_OK" = "yes" ]; then
    echo "[$NOW] verificado en R2: db=$R2_DB_COUNT archivos, uploads=$R2_UP_COUNT archivos"
  fi
else
  echo "[$NOW] skip verificación R2 (push falló)"
fi

# --- 5. Retención (corre SIEMPRE) ------------------------------------------------
# Local corta (7 días, conservando las 3 más nuevas): el disco del VPS es
# chico y cada deploy suma un snapshot. R2 (30 días) es la copia de resguardo.
prune_local "$BACKUP_ROOT/db" 'portal659-*.sql.gz' 7 3
prune_local "$BACKUP_ROOT/uploads" 'uploads-*.tar.gz' 7 3
if [ "$PUSH_OK" = "yes" ]; then
  rclone delete "R2:$R2_BUCKET/db" --min-age 30d >/dev/null 2>&1 || true
  rclone delete "R2:$R2_BUCKET/uploads" --min-age 30d >/dev/null 2>&1 || true
else
  echo "[$NOW] skip limpieza R2 (sin conexión)"
fi

if [ "$PUSH_OK" = "yes" ] && [ "$VERIFY_OK" = "yes" ]; then
  echo "[$NOW] backup completo (retención: 7 días local / 30 días R2, 3 copias locales siempre)"
  exit 0
else
  echo "[$NOW] backup INCOMPLETO: copia local OK, offsite falló (revisá cron.log)"
  exit 1
fi
