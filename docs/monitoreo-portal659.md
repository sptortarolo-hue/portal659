# Monitoreo de Portal 659 — salud del borde, auto-heal y forense

Runbook del monitor que se instaló tras el corte del **28-oct-2026** (Cloudflare
devolvía **521** con el VPS vivo y SSH respondiendo).

## Por qué existe

El 28-oct-2026 el sitio estuvo caído ~10 minutos. Lo que se pudo verificar desde
afuera:

- el VPS `103.195.103.245` respondía a ping y al SSH (puerto 22 abierto)
- **nadie escuchaba en 80 ni 443** → Cloudflare no podía conectar → **521**
- el deploy anterior había terminado `success` con los containers `Healthy`

Dos agujeros reales que dejaron pasar el corte:

1. **El deploy no verifica el borde.** El `healthcheck` de `docker-compose.yml`
   es del container `app`, y el workflow terminaba con
   `echo "Deploy completado!"` sin pegarle a la URL pública. Un nginx roto daba
   un deploy en verde con el sitio en 521.
2. **nginx muere entero si falta el certificado.** `nginx.conf` referencia
   `ssl_certificate /etc/nginx/certs/origin.pem` y `.key` al *parsear* la
   config: si falta **uno** de los dos, el contenedor sale con
   `cannot load certificate` y caen **80 y 443 juntos**. El deploy solo
   regeneraba el placeholder `if [ ! -f origin.pem ]`, sin mirar el `.key`.

Además, desde adentro del VPS **no se ve un host apagado** (localhost responde),
y la evidencia de una caída se pierde: `dmesg` es un ring buffer y `journalctl`
rota. Por eso el monitor captura el forense **antes** de tocar nada.

## Arquitectura: dos capas

| Capa | Dónde corre | Qué mira | Qué ve que la otra no |
|---|---|---|---|
| **Interna** | `scripts/health-monitor.sh`, cron cada 2 min en el VPS | `http://127.0.0.1/api/health` con `Host: www.portal659.com.ar` | el estado de los containers, el disco, la RAM, `dmesg` |
| **Externa** | `.github/workflows/health-monitor.yml`, cada 5 min | `https://www.portal659.com.ar/api/health` | un VPS apagado, red cortada, SSH rechazado |

El chequeo interno pasa por **nginx → app → Postgres**, o sea exactamente lo que
Cloudflare necesita para no dar 521. No usa la URL pública a propósito: si
Cloudflare mismo se cae, el monitor interno no debe alertar ni reiniciar nada.

## Qué hace cuando detecta un corte

1. **Espera 2 fallos seguidos** (o `--force`) — un redeploy o un restart de
   nginx pueden tardar más que el intervalo del cron.
2. **Captura forense ANTES de tocar nada** →
   `/opt/portal659-monitor/forensics-<UTC>.log`: `uptime`, `free -m`, `df -h`,
   `docker ps -a`, `docker inspect` por container (status, restarts, OOMKilled,
   exit code, error), `ss -ltnp` en 80/443, OOM en `dmesg`, `journalctl -u
   docker`, logs de nginx/app/db, y si están los certs.
3. **Auto-heal acotado**, con tres condiciones de seguridad:
   - si el **disco está ≥ 90% NO reinicia** (no es la causa y puede empeorar)
   - **cooldown de 10 min** entre heals (anti-flapping)
   - **nunca corre `compose up -d --build`**: reconstruir desde un monitor es
     justo el chown de CPU/RAM/disco que se sospecha que voltea este VPS de 2GB

   El orden del heal es: `systemctl restart docker` si el daemon está caído →
   `docker compose up -d` (sin build) → si nginx sigue sin escuchar y el log
   dice `cannot load certificate`, regenera el placeholder y reinicia nginx →
   si no, `docker restart` de nginx y app (re-resuelve el DNS del upstream).
4. **Alerta a Telegram** con el resumen y la ruta del forense.
5. **Avisa cuando se recupera** (solo si venía de un corte, no en cada check OK).

## Configurar Telegram (2 minutos)

Sin esto el monitor funciona igual — registra todo y solo no manda el chat.

1. En Telegram, buscá **@BotFather** → `/newbot` → elegí nombre y usuario.
   Te devuelve el token, con forma `123456789:AAH...`.
2. Mandale cualquier mensaje a tu bot nuevo (si no, `getUpdates` viene vacío) y
   después corré:
   ```bash
   curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | grep -o '"chat":{"id":[-0-9]*'
   ```
   Ese número es el **chat id**. (Para un grupo: agregá el bot al grupo y usá el
   id negativo del grupo.)
3. Agregá los dos secrets al repo:
   ```bash
   gh secret set TELEGRAM_BOT_TOKEN
   gh secret set TELEGRAM_CHAT_ID
   ```
   o desde la web: *Settings → Secrets and variables → Actions → New repository
   secret*.

El deploy los escribe en `/opt/portal659/.env`; si los secrets no están, saltea
la escritura y el monitor arranca en modo fail-open.

### Desde el panel: `/admin/monitor`

El dashboard de admin trae el estado sin SSH: **Dashboard → Monitor** (y un
semáforo compacto arriba del dashboard con disco % y fallos seguidos, que linka
al tab). Muestra lo que el cron escribe en cada corrida —no corre docker, no
toca el host:

- semáforo grande (arriba / caído + HTTP y fallos seguidos), KPIs de disco,
  memoria, swap y load con edad de la última corrida;
- tabla de **contenedores** (estado, health, reinicios, OOM, exit code, error);
- tarjetas de **auto-heal** (último intento, cooldown, umbral de disco, fallos
  para actuar) y **cortes registrados** (`outages.log`, una fila por corte);
- **forenses** descargables en un modal (se leen del montaje, sin SSH);
- log del monitor (rotado) y acceso a los runs del monitor externo.

Dos acciones desde el panel:

- **Verificar el borde ahora**: pega a `/api/health` vía nginx (el mismo camino
  de Cloudflare) y reporta HTTP + latencia + si la base responde. Es la misma
  verificación que hace el deploy al terminar.
- **Probar alerta de Telegram**: manda un mensaje de prueba al chat configurado.
  Si no llega, el tab muestra igual si `telegram_configured` está en `false`.

Si el directorio no está montado (`/monitor:ro` falta o está vacío), el tab
muestra "Monitor no instalado" con el link a los runs de GitHub.

> El montaje es **read-only** a propósito: el panel lee, el cron escribe. El
> contenedor no puede tocar el estado del host.

## Revisar y operar (VPS)

```bash
# estado actual (http, fallos seguidos, disco, containers)
/opt/portal659-monitor/health-monitor.sh --status

# correr a mano ahora (saltea el contador de fallos y el cooldown)
/opt/portal659-monitor/health-monitor.sh --force

# log rotado a 300 líneas
tail -n 50 /opt/portal659-monitor/monitor.log

# forenses guardados (uno por corte)
ls -lt /opt/portal659-monitor/forensics-*.log | head

# probar el envío a Telegram
/opt/portal659-monitor/alert-telegram.sh "prueba desde el VPS"
```

Los runs del monitor externo quedan en
*Actions → Health Monitor*. Si el sitio sigue caído, el run termina en rojo.

## Qué se cambió además del monitor

**`deploy.yml`**

- Valida el `.pem` **y** el `.key` antes de arrancar nginx (antes solo el `.pem`).
- **Verificación real del borde al final**: pega por 80 y por 443 al origen
  (`curl` con `Host:` y `-k` para el TLS) y **falla el deploy** si no responde,
  volcando el estado y el log de nginx. Un deploy nunca más puede terminar en
  verde con el sitio en 521.
- Instala el cron del monitor (self-managed, se auto-repara en cada deploy) y
  escribe los secrets de Telegram al `.env`.

**`nginx.conf`** — sin cambios. **`docker-compose.yml`** — monta
`/opt/portal659-monitor:/monitor:ro` en el servicio `app` y pasa
`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` al contenedor (solo los lee
`alert-telegram.sh` en los disparos del cron; nunca se exponen por la API).

## Deuda conocida

- **No hay acceso SSH desde la máquina de desarrollo**: las claves de
  `~/.ssh/actions_deploy` y `~/.ssh/portal659` son rechazadas por el servidor
  (`Permission denied (publickey)`), solo queda auth por password. Lo que
  automatiza el monitor es justamente lo que antes obligaba a entrar a mano.
- **La causa raíz del corte del 28-oct sigue sin confirmarse.** Las hipótesis,
  en orden de probabilidad con la evidencia disponible: nginx en loop de restart
  por certificado (explica 521 con el resto aparentemente sano), OOM del daemon
  de docker tras 12 builds en 3,5 h, o disco lleno por los snapshots de backup
  que hace cada deploy. El forense del monitor la va a confirmar la próxima vez.
