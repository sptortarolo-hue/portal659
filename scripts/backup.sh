#!/bin/sh
# Portal 659 — backup self-managed (DB + uploads → Cloudflare R2)
#
# Dos modos:
#   - cron diario (07:00 UTC = 04:00 AR, instalado por deploy.yml): completo
#     (pg_dump + tar de uploads).
#   - snapshot previo a cada deploy (--db-only o env BACKUP_DB_ONLY=1): SOLO
#     dump de DB. El deploy no pisa el volumen de uploads y el cron diario ya
#     lo sube a R2 (30 días): con ~100 deploys/semana, sumarle el tar de
#     uploads (~350MB cada uno) a cada deploy fue una de las causas del disco
#     lleno de sep-2026.
#
# Corre en el HOST como root. Independiente del sistema:
# funciona en cualquier VPS con Docker.
#
# - DB:    docker exec portal659-db pg_dump → gzip (valida integridad + completitud)
# - Files: tar del volumen uploads_data (fotos de productos/logos; se excluye
#   downloads/ — el .zip del agente y APKs son reconstruibles y pesaban ~100MB
#   por snapshot) → R2 (bucket privado; config por env vars, sin archivo)
# - Push:  rclone → R2 (bucket privado; config por env vars, sin archivo de config)
# - Retención: DB por CANTIDAD (los últimos BACKUP_DB_KEEP=10) — los snapshots
#   db-only por deploy pueden ser 100+/semana y con días-límite se desbordaba,
#   uploads 7 días local (conservando siempre las 3 copias más nuevas),
#   30 días en R2. La limpieza local corre SIEMPRE aunque falle el push
#   (disco VPS chico: la acumulación por push fallido ya lo llenó una vez
#   y volteó Postgres). cron.log se rota a 500 líneas por run.
#
# Env (del /opt/portal659/.env que escribe el deploy desde GitHub secrets):
#   POSTGRES_USER / POSTGRES_DB (defaults portal659)
#   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT
#   R2_BUCKET (default portal659-backups)
#   BACKUP_DB_KEEP (últimos N dumps de DB que quedan en disco, default 10)
#
# Salida: 0 = OK; 1 = error (queda en cron.log / log del deploy).
# /opt/portal659-backups está FUERA de /opt/portal659: el deploy no lo borra nunca.

set -u

[ "$(id -u)" = "0" ] || { echo "ERROR: backup.sh corre como root"; exit 1; }

BACKUP_ROOT=/opt/portal659-backups
ENV_FILE=/opt/portal659/.env
NOW=$(date -u +%Y%m%d-%H%M%S)
BACKUP_DB_KEEP=${BACKUP_DB_KEEP:-10}

# --db-only (o env BACKUP_DB_ONLY=1): snapshot de deploy = solo dump de DB.
DB_ONLY=no
[ "${1:-}" = "--db-only" ] && DB_ONLY=yes
[ "${BACKUP_DB_ONLY:-0}" = "1" ] && DB_ONLY=yes

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

# Recorte por CANTIDAD: deja los $3 más nuevos del patrón, borra el resto
# (sin mirar la edad). Lo usa el dump de DB: los snapshots db-only por deploy
# pueden ser 100+ por semana y un límite por días se desbordaba — igual que
# prune_local, corre SIEMPRE (aunque el push a R2 haya fallado).
prune_keep() {
  _dir=$1; _pat=$2; _n=$3
  ls -t "$_dir"/$_pat 2>/dev/null | tail -n +"$((_n + 1))" 2>/dev/null | while IFS= read -r _f; do
    rm -f "$_f"
  done
}

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

# --- 2. Uploads (solo modo completo; el snapshot de deploy es db-only) ---------
# El volumen es <proyecto>_uploads_data según el nombre del folder del compose:
# se busca por sufijo para no depender del prefijo.
UPLOADS_FILE="$BACKUP_ROOT/uploads/uploads-$NOW.tar.gz"
if [ "$DB_ONLY" = "yes" ]; then
  echo "[$NOW] modo db-only: skip uploads (los cubre el cron diario con R2 30 días)"
  rm -f "$UPLOADS_FILE" 2>/dev/null
else
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
# Sin exit acá: la limpieza local corre SIEMPRE (ver paso 5). En db-only no hay
# uploads que subir (nunca se creó el tar).
PUSH_OK=yes
rclone copy "$BACKUP_ROOT/db" "R2:$R2_BUCKET/db" --no-traverse 2>&1 >/dev/null \
  || PUSH_OK=no
if [ "$DB_ONLY" = "no" ]; then
  if [ "$PUSH_OK" = "yes" ]; then
    rclone copy "$BACKUP_ROOT/uploads" "R2:$R2_BUCKET/uploads" --no-traverse 2>&1 >/dev/null \
      || PUSH_OK=no
  fi
fi
if [ "$PUSH_OK" = "yes" ]; then
  echo "[$NOW] push a R2 OK"
else
  echo "[$NOW] ERROR: fallo el push a R2 (copia local queda)"
fi

# --- 4. Verificación post-subida (solo si el push anduvo) ----------------------
# En db-only sólo hay DB: el uploads no se subió ni existe, no se verifica.
VERIFY_OK=yes
if [ "$PUSH_OK" = "yes" ]; then
  CHECK_UP=no
  if [ "$DB_ONLY" = "no" ]; then
    CHECK_UP=yes
    R2_UP_COUNT=$(rclone ls "R2:$R2_BUCKET/uploads" --max-depth 1 2>/dev/null | wc -l | tr -d ' ')
  fi
  R2_DB_COUNT=$(rclone ls "R2:$R2_BUCKET/db" --max-depth 1 2>/dev/null | wc -l | tr -d ' ')
  if [ "$R2_DB_COUNT" = "0" ] || { [ "$CHECK_UP" = "yes" ] && [ "$R2_UP_COUNT" = "0" ]; }; then
    echo "[$NOW] CRITICAL: R2 quedó vacío después del push (db=$R2_DB_COUNT uploads=${R2_UP_COUNT:-n/a}) — reintentando"
    if rclone copy "$BACKUP_ROOT/db" "R2:$R2_BUCKET/db" --no-traverse 2>&1 >/dev/null; then
      R2_DB_COUNT=$(rclone ls "R2:$R2_BUCKET/db" --max-depth 1 2>/dev/null | wc -l | tr -d ' ')
    fi
    if [ "$CHECK_UP" = "yes" ]; then
      rclone copy "$BACKUP_ROOT/uploads" "R2:$R2_BUCKET/uploads" --no-traverse 2>&1 >/dev/null || true
      R2_UP_COUNT=$(rclone ls "R2:$R2_BUCKET/uploads" --max-depth 1 2>/dev/null | wc -l | tr -d ' ')
    fi
    if [ "$R2_DB_COUNT" = "0" ] || { [ "$CHECK_UP" = "yes" ] && [ "$R2_UP_COUNT" = "0" ]; }; then
      echo "[$NOW] CRITICAL: R2 sigue vacío tras re-intento (db=$R2_DB_COUNT uploads=${R2_UP_COUNT:-n/a})"
      VERIFY_OK=no
    fi
  fi
  if [ "$VERIFY_OK" = "yes" ]; then
    if [ "$CHECK_UP" = "yes" ]; then
      echo "[$NOW] verificado en R2: db=$R2_DB_COUNT archivos, uploads=$R2_UP_COUNT archivos"
    else
      echo "[$NOW] verificado en R2: db=$R2_DB_COUNT archivos (db-only)"
    fi
  fi
else
  echo "[$NOW] skip verificación R2 (push falló)"
fi

# --- 5. Retención (corre SIEMPRE) ------------------------------------------------
# DB: últimos BACKUP_DB_KEEP dumps (por cantidad, no días: los snapshots db-only
# por deploy llegaron a 100+/semana y con días-límite desbordaba). Uploads:
# 7 días (cron diario, 3 más nuevas siempre). R2 (30 días) es el resguardo.
prune_keep "$BACKUP_ROOT/db" 'portal659-*.sql.gz' "$BACKUP_DB_KEEP"
# Uploads: limpieza por edad en ambos modos — el snapshot db-only no genera
# tar pero igual poda los viejos (los excedentes de la época pre-db-only se
# van borrando a medida que pasan los 7 días).
prune_local "$BACKUP_ROOT/uploads" 'uploads-*.tar.gz' 7 3
if [ "$PUSH_OK" = "yes" ]; then
  rclone delete "R2:$R2_BUCKET/db" --min-age 30d >/dev/null 2>&1 || true
  if [ "$DB_ONLY" = "no" ]; then
    rclone delete "R2:$R2_BUCKET/uploads" --min-age 30d >/dev/null 2>&1 || true
  fi
else
  echo "[$NOW] skip limpieza R2 (sin conexión)"
fi

if [ "$PUSH_OK" = "yes" ] && [ "$VERIFY_OK" = "yes" ]; then
  if [ "$DB_ONLY" = "yes" ]; then
    echo "[$NOW] snapshot db-only OK (retención DB: últimos $BACKUP_DB_KEEP)"
  else
    echo "[$NOW] backup completo (retención: DB últimos $BACKUP_DB_KEEP, uploads 7 días local / 30 días R2)"
  fi
  exit 0
else
  echo "[$NOW] backup INCOMPLETO: copia local OK, offsite falló (revisá cron.log)"
  exit 1
fi
