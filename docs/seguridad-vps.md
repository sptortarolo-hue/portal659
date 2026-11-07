# Runbook de seguridad del VPS — Portal 659

> Para el operador del servidor (VexyHost, Ubuntu 24.04, 2GB RAM).
> Cada paso incluye el comando exacto y cómo verificar que funcionó.
> Ejecutá de arriba a abajo; los pasos 1–3 son los que más riesgo mitigan.
> Todos los comandos asumen que estás logueado como root (el deploy de
> GitHub Actions lo hace así).

## 0. Pre-requisitos

```bash
# Confirmar que el sitio responde y el contenedor de DB está sano.
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1/api/health -H "Host: www.portal659.com.ar"
docker ps --format '{{.Names}} {{.Status}}'
```

## 1. Firewall (ufw) — cerrar el bypass de Cloudflare

El origen (VPS) está hoy expuesto en 80/443 al mundo. Un atacante puede
saltarse Cloudflare (y su WAF) pegándole directo al IP. Cerramos 80/443
salvo las IPs de Cloudflare + localhost (el monitor interno).

```bash
# IPs de Cloudflare (IPv4) — actualizar periódicamente desde
# https://www.cloudflare.com/ips-v4/
cat > /tmp/cf-ips.txt <<'EOF'
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
190.93.240.0/20
188.114.96.0/20
197.234.240.0/22
198.41.128.0/17
172.64.0.0/13
104.16.0.0/13
162.158.0.0/15
104.24.0.0/14
EOF

apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing

# SSH: solo tu IP (o dejá abierto si no tenés IP fija, pero cambiá el puerto).
ufw allow 22/tcp

# HTTP/HTTPS: solo Cloudflare + localhost (monitor interno).
for ip in $(cat /tmp/cf-ips.txt); do
  ufw allow from "$ip" to any port 80 proto tcp
  ufw allow from "$ip" to any port 443 proto tcp
done
ufw allow from 127.0.0.1 to any port 80 proto tcp
ufw allow from 127.0.0.1 to any port 443 proto tcp

ufw --force enable
ufw status verbose
```

**Verificación (desde tu PC, NO desde el VPS):**

```bash
# Debe dar timeout/refused (no 200):
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 8 http://103.195.103.245/ -H "Host: www.portal659.com.ar"
# Debe seguir dando 200 (por Cloudflare):
curl -sS -o /dev/null -w "%{http_code}\n" https://www.portal659.com.ar/
```

**Rollback** si te quedás afuera: en el panel de VexyHost usá la consola VNC y `ufw disable`.

## 2. SSH hardening

```bash
cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak.$(date +%s)
cat > /etc/ssh/sshd_config.d/99-portal659.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
X11Forwarding no
EOF
systemctl restart ssh
sshd -t && echo "sshd config OK"
```

> El deploy de GitHub Actions usa clave SSH (no password), así que no se rompe.

## 3. fail2ban

```bash
apt-get install -y fail2ban
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = 22
EOF
systemctl enable --now fail2ban
fail2ban-client status sshd
```

## 4. Parches de seguridad automáticos

```bash
apt-get install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades   # elegir "Yes"
grep -E 'Unattended-Upgrade::Allowed-Origins' /etc/apt/apt.conf.d/50unattended-upgrades
```

## 5. Postgres no expuesto al exterior

```bash
# El contenedor db NO debe publicar puerto al host.
docker port portal659-db 2>/dev/null || echo "OK: sin puertos publicados"
ss -ltnp | grep -E ':5432|:5433' || echo "OK: 5432 no escucha en el host"

# Contraseña fuerte: verificar longitud de POSTGRES_PASSWORD en .env
grep '^POSTGRES_PASSWORD=' /opt/portal659/.env | awk -F= '{print length($2)}'
```

Si la contraseña es corta, cambiarla en `.env` y recrear el contenedor
(`docker compose up -d db`) — ojo: la DB ya inicializada no cambia la
contraseña del usuario existente; hay que correr
`ALTER USER portal659 WITH PASSWORD '...'` dentro del contenedor.

## 6. Permisos del .env

```bash
chown root:root /opt/portal659/.env
chmod 600 /opt/portal659/.env
ls -l /opt/portal659/.env
```

## 7. Bucket R2 privado + encriptación de dumps (opcional)

Verificá en el panel de Cloudflare R2 que el bucket `portal659-backups` no
tenga "Public access" habilitado. Las credenciales (`R2_*`) del `.env`
deben tener permisos solo de `s3:PutObject`/`s3:GetObject`/`s3:ListBucket`
sobre ese bucket, no `s3:*`.

Para encriptar los dumps en reposo (recomendado si el bucket llegara a
exponerse), agregar `age` al backup:

```bash
apt-get install -y age
# Generar clave una sola vez y guardarla en un gestor de contraseñas:
age-keygen -o /root/portal659-backup.key
# Luego modificar scripts/backup.sh para cifrar con:
#   age -r "$(age-keygen -y /root/portal659-backup.key)" ...
```

> Esto requiere cambiar `scripts/backup.sh` en el repo y volver a deployar.
> La clave privada (`portal659-backup.key`) NO va al repo ni al VPS del
> código: guardala aparte.

## 8. Verificación final

```bash
# Headers de seguridad desde el origen (pasando por nginx):
curl -sS -I https://www.portal659.com.ar/ | grep -iE 'x-frame-options|x-content-type-options|referrer-policy|strict-transport-security|permissions-policy|content-security-policy'

# Webhook MP fail-closed (sin secret debería dar 500; con secret configurado da 401/200):
# (no correr en prod con datos reales; solo verificar que no devuelva 200 sin firma)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://www.portal659.com.ar/api/webhooks/mercadopago \
  -H 'Content-Type: application/json' -d '{"type":"payment","data":{"id":"123"}}'

# Monitor de salud sigue verde:
cat /opt/portal659-monitor/status.json 2>/dev/null | head -c 200; echo
```

## 9. Aplicar la migración de 2FA

Una sola vez, contra el contenedor de DB:

```bash
cd /opt/portal659
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-2fa-totp.sql
```

Verificación:

```bash
docker exec -i portal659-db psql -U portal659 -d portal659 -c "\d profiles" | grep -i totp
```

## 10. Rollback de un admin bloqueado

Si un admin perdió el autenticador:

```bash
docker exec -i portal659-db psql -U portal659 -d portal659 -c \
  "UPDATE profiles SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL WHERE email = 'admin@portal659.com.ar';"
```

## Notas

- El CSP está en `Report-Only`: revisar `[API:csp-report]` en `docker logs portal659-app`
  durante una semana antes de hacerlo obligatorio (renombrar la cabecera en
  `next.config.ts`).
- Los reportes de CSP caen en `/api/csp-report` y se loguean con rate-limit
  30/min por IP.
- El firewall de Cloudflare (WAF) sigue siendo la primera línea; este
  runbook cierra el bypass directo al origen.
- Re-ejecutar el paso 1 cada vez que Cloudflare publique nuevas IPs.
