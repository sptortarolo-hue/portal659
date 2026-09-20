#!/bin/sh
# Portal 659 — restore de backup (DB + uploads + certs TLS)
#
# Uso (en el HOST, como root, después del deploy):
#   bash /opt/portal659/scripts/restore.sh <db.sql.gz> [uploads.tar.gz] [certs.tar.gz]
#
# 1. DROP SCHEMA public + restore del dump (pg_dump full incluye schema+data;
#    sin el DROP chocan los CREATE TABLE contra el schema.sql del primer arranque)
# 2. untar de uploads al volumen (borra lo existente: idempotente)
# 3. certs TLS a /opt/portal659-certs + restart nginx (cert Origin CA de Cloudflare)
# 4. sanity: vendors/orders
#
# Se puede correr con solo el dump (uploads/certs quedan como están).

set -u

[ "$(id -u)" = "0" ] || { echo "ERROR: restore.sh corre como root"; exit 1; }

DUMP="${1:-}"
UPLOADS_TGZ="${2:-}"
CERTS_TGZ="${3:-}"

[ -n "$DUMP" ] || { echo "uso: restore.sh <db.sql.gz> [uploads.tar.gz] [certs.tar.gz]"; exit 1; }
[ -f "$DUMP" ] || { echo "ERROR: no existe $DUMP"; exit 1; }

ENV_FILE=/opt/portal659/.env
PGUSER=""
PGDB=""
if [ -f "$ENV_FILE" ]; then
  PGUSER=$(sed -n 's/^POSTGRES_USER=//p' "$ENV_FILE" | head -n 1)
  PGDB=$(sed -n 's/^POSTGRES_DB=//p' "$ENV_FILE" | head -n 1)
fi
PGUSER=${PGUSER:-portal659}
PGDB=${PGDB:-portal659}

docker ps --format '{{.Names}}' | grep -qx 'portal659-db' \
  || { echo "ERROR: portal659-db no corre (¿deploy hecho?)"; exit 1; }

# --- 1. DB -------------------------------------------------------------------
echo "[1/4] DROP SCHEMA + restore DB desde $DUMP"
docker exec portal659-db psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' \
  || { echo "ERROR: fallo el DROP SCHEMA"; exit 1; }
gunzip -c "$DUMP" | docker exec -i portal659-db psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -q \
  || { echo "ERROR: fallo el restore de la DB (revisá el dump)"; exit 1; }

# --- 2. Uploads ----------------------------------------------------------------
# Volumen buscado por sufijo (compose lo nombra <proyecto>_uploads_data).
VOL=$(docker volume ls --format '{{.Name}}' | grep -E '(^|_)uploads_data$' | head -n 1)
if [ -n "$UPLOADS_TGZ" ] && [ -f "$UPLOADS_TGZ" ]; then
  if [ -n "$VOL" ]; then
    echo "[2/4] restaurando uploads al volumen $VOL"
    UPLOADS_DIR=$(cd "$(dirname "$UPLOADS_TGZ")" && pwd)
    docker run --rm -v "$VOL":/data -v "$UPLOADS_DIR":/migrate:ro \
      -e TGZ="$(basename "$UPLOADS_TGZ")" alpine:3 \
      sh -c 'rm -rf /data/* && tar xzf "/migrate/$TGZ" -C /data' \
      || { echo "ERROR: fallo el restore de uploads"; exit 1; }
  else
    echo "WARNING: sin volumen uploads_data, skip uploads"
  fi
else
  echo "[2/4] sin uploads.tar.gz, skip"
fi

# --- 3. Certs TLS ----------------------------------------------------------------
if [ -n "$CERTS_TGZ" ] && [ -f "$CERTS_TGZ" ]; then
  echo "[3/4] certs TLS a /opt/portal659-certs"
  tar xzf "$CERTS_TGZ" -C /opt || { echo "ERROR: fallo extrayendo certs"; exit 1; }
  if docker ps --format '{{.Names}}' | grep -qx 'portal659-nginx'; then
    docker restart portal659-nginx >/dev/null
  fi
else
  echo "[3/4] sin certs.tar.gz, skip (el deploy genera placeholder autofirmado;"
  echo "      el modo Strict de Cloudflare requiere restaurar el cert real después)"
fi

# --- 4. Sanity ----------------------------------------------------------------
echo "[4/4] sanity check"
docker exec portal659-db psql -U "$PGUSER" -d "$PGDB" -t \
  -c "SELECT 'vendors: '||count(*) FROM vendors;" 2>/dev/null || true
docker exec portal659-db psql -U "$PGUSER" -d "$PGDB" -t \
  -c "SELECT 'orders: '||count(*) FROM orders;" 2>/dev/null || true

echo "Restore completo. Verificá https://www.portal659.com.ar/api/health → {\"status\":\"ok\",\"db\":true}"
exit 0
