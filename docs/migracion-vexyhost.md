# Migración a VexyHost (cutover) + backup diario self-managed

> Decisión (sep-2026): migrar el VPS a **VexyHost** (Ubuntu 24.04, 2GB RAM) con
> **cutover con ventana**. VexyHost no tiene backup diario: el backup es
> **self-managed** — cron + `pg_dump` + rclone → Cloudflare R2, independiente del
> host (funciona en cualquier VPS).

## Qué se protege

1. `db_data` (Postgres: pedidos, clientes, tokens MP cifrados) → `pg_dump` gzip diario
2. `uploads_data` (fotos de productos/logos, `downloads/`) → tar gzip diario
3. `/opt/portal659-certs` (cert Origin CA de Cloudflare) → tar + restaurar al migrar
4. `.env` — **NO hace falta**: lo regenera el deploy desde secrets de GitHub.

Retención: **14 días local + 30 días en R2** (bucket `portal659-backups`, privado).
No hace falta migrar tampoco: sesión de WhatsApp del bot (vive en el teléfono
APK Portal Wa Link) ni cola de impresión (memoria del relay).

---

## 0. Bucket R2 (hecho sep-2026)

- dash.cloudflare.com → R2 → bucket `portal659-backups` (privado, Storage Class Standard).
- Token de API de **cuenta** (no de usuario): permisos **Object Read & Write**, scope al bucket.
- Secrets GitHub: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`
  (endpoint **exacto** del token, ej. `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).

## 1. VexyHost: Docker

```bash
ssh -p 22 root@103.195.103.245
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version
```

## 2. Deploy desde GitHub

1. Secrets: `VPS_HOST=103.195.103.245`, `VPS_USER=root`, `VPS_SSH_KEY=<clave privada>`
   (+ los 3 de R2 ya cargados). El puerto del deploy es `22`.
2. Actions → "Deploy to VPS" → **Run workflow**. El deploy arma `/opt/portal659` +
   `.env` (incl. `R2_*`) + build + contenedores (DB vacía con schema).
3. El mismo deploy instala el cron de backup (`/etc/cron.d/portal659-backup`,
   07:00 UTC = 04:00 AR) y rclone. `/opt/portal659-backups` está fuera del path
   del deploy: no se borra nunca.
4. El deploy también hace **snapshot previo** (backup de DB+uploads a R2) en cada deploy.

## 3. Exportar del VPS viejo

```bash
# VPS VIEJO (el actual)
mkdir -p /tmp/migrate
docker exec portal659-db pg_dump -U portal659 -d portal659 | gzip > /tmp/migrate/db.sql.gz
# Nombre del volumen: verificar con `docker volume ls | grep uploads` (ej. portal659_uploads_data)
docker run --rm -v portal659_uploads_data:/data:ro -v /tmp/migrate:/migrate alpine:3 \
  tar czf /migrate/uploads.tar.gz -C /data .
tar czf /tmp/migrate/certs.tar.gz -C /opt portal659-certs
```

## 4. Transferir

```bash
# VPS NUEVO: crear el folder destino
ssh -p 22 root@103.195.103.245 mkdir -p /tmp/migrate
# VPS VIEJO → NUEVO (directo; alternativamente descargar a tu PC y subir)
scp -P 22 /tmp/migrate/db.sql.gz /tmp/migrate/uploads.tar.gz /tmp/migrate/certs.tar.gz \
  root@103.195.103.245:/tmp/migrate/
```

## 5. Restaurar en VexyHost

```bash
ssh -p 22 root@103.195.103.245
bash /opt/portal659/scripts/restore.sh \
  /tmp/migrate/db.sql.gz /tmp/migrate/uploads.tar.gz /tmp/migrate/certs.tar.gz
```

El script hace: `DROP SCHEMA public` + restore del dump (`ON_ERROR_STOP`) + untar
uploads al volumen + certs a `/opt/portal659-certs` + restart nginx + sanity
(vendors/orders). Idempotente: se puede re-correr.

## 6. DNS (Cloudflare)

1. Antes de cortar: DNS → anotar TTL de los records (Auto + Proxied cambia al toque).
2. Cambiar A records `@` y `www` → `103.195.103.245` (Proxied).
3. SSL/TLS: modo **Full (strict)** requiere el cert Origin CA restaurado en
   `/opt/portal659-certs` (paso 5). Si no se restauró, el deploy genera un
   placeholder autofirmado → el sitio funciona con Flexible hasta instalar el real.

## 7. Verificación post-migración

- [ ] `https://www.portal659.com.ar/api/health` → `{"status":"ok","db":true}`
- [ ] Home + login + `/buscar` + `/tienda/[slug]` (fotos visibles) + `/mis-pedidos`
- [ ] Panel: `/vendor/dashboard` (histórico de pedidos), Comanda/Mesas cargan
- [ ] Pedido de prueba + pago MP (webhook: mismo dominio, no cambia)
- [ ] Portal Print reconecta (`/printbridge`), impresión de prueba
- [ ] Portal Wa Link reconecta (`/wa`), bot responde
- [ ] Backup: `cat /opt/portal659-backups/cron.log` y/o correr a mano
      `bash /opt/portal659-backups/backup.sh` + `rclone lsd R2:portal659-backups/db`

## 8. Fallback y limpieza

- VPS viejo encendido **2-3 días** como fallback (tiene TODO: DB + uploads + certs).
- Confirmada la migración → apagar/cancelar el viejo.
- El backup diario queda activo en el VexyHost + R2 (offsite): si el disco muere,
  se restaura con `restore.sh` desde el dump bajado de R2 (abajo).

---

## Restore desde R2 (desastre)

```bash
# bajar el dump más reciente de R2 (rclone con las credenciales R2_* del .env)
source /opt/portal659/.env
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
rclone copy R2:portal659-backups/db /tmp/restore-db --no-traverse
LATEST=$(ls -t /tmp/restore-db/*.sql.gz | head -n 1)
bash /opt/portal659/scripts/restore.sh "$LATEST"
# (uploads si hiciera falta: rclone copy R2:portal659-backups/uploads /tmp/restore-uploads --no-traverse
#  + restore.sh "$LATEST" /tmp/restore-uploads/uploads-<fecha>.tar.gz)
```

## Backup manual puntual

```bash
bash /opt/portal659-backups/backup.sh   # backup ya (local + push R2)
cat /opt/portal659-backups/cron.log     # log de las corridas del cron
```
