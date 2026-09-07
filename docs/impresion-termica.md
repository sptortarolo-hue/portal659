# Impresión térmica (Portal Print)

Feature de **impresión térmica por red Wi-Fi** para el dashboard de comercios gastronómicos.

> **ESTADO (29-ago-2026): DEPLOY EN PRODUCCIÓN INCOMPLETO — SIN PRUEBA DE CAMPO.**
> El código está terminado y commiteado (commit `40291aa`), la migración de DB está aplicada en
> producción, pero el deploy del VPS quedó a medio camino (ver [Estado del deploy](#estado-del-deploy))
> y **aún no hay impresora física** para probar. Este documento es el respaldo de lo trabajado.

## Objetivo

Imprimir tickets (comandas/ticket de pedido) en una impresora térmica **Union TP85-NET** (conector
Ethernet RJ-45, protocolo ESC/POS) desde el panel del comercio, usando **un celular Android** como
puente. No se abren puertos en el router ni se necesita IP pública: funciona detrás de NAT/CGNAT
con IP dinámica.

## Por qué existe el puente

El navegador **no puede** imprimir térmico directo a una impresora de red local:

- No hay API de navegador para sockets TCP raw a una IP privada.
- Una página servida por HTTPS no puede llamar a `http://192.168.x.x` (mixed content).

Solución: el servidor arma el buffer ESC/POS (una sola fuente de verdad), un **relay WebSocket**
lo entrega a la **app Android "Portal Print"** (conectada saliente al relay), y la app lo manda por
TCP 9100 a la impresora dentro de la red local del comercio.

```
┌─────────────┐  POST /api/print   ┌──────────────┐   HTTP /push (interno)   ┌──────────────┐
│  Dashboard  │ ─────────────────► │    Servidor  │ ───────────────────────► │    Relay     │
│ (Next.js)   │                    │ (Next.js app)│      x-bridge-secret     │ print-bridge │
└─────────────┘                    └──────────────┘                          └──────────────┘
                                                        WebSocket /printbridge?token=...
                                                                               │
                                                                               ▼
                                                           ┌──────────────┐  TCP 9100  ┌──────────────┐
                                                           │  App Portal  │ ─────────► │  TP85-NET    │
                                                           │  Print (And) │            │  (Wi-Fi LAN) │
                                                           └──────────────┘            └──────────────┘
```

- El servidor construye el buffer ESC/POS con **un solo generador** (`src/lib/thermal-printer.ts`).
- El relay responde al servidor `ok` | `offline` | `error` con timeout de 20s.
- La app solo entrega los bytes por TCP y responde el ack (no genera tickets).
- Alternativa **modo `server`**: TCP directo desde el VPS a la impresora (sirve si la impresora es
  alcanzable desde el servidor, p. ej. IP pública dedicada).

## Componentes

| Pieza | Archivos | Rol |
|---|---|---|
| Motor ESC/POS | `src/lib/thermal-printer.ts` | Builders → `BufferResult`, `dispatchPrint` (rutea `server`/`app`), `pushToBridge` |
| Token de comercio | `src/lib/print-token.ts` | Genera `pp_<32 caracteres>` (20 bytes base64url) |
| API de impresión | `src/app/api/print/route.ts` | `POST` `{orderId, test, type, tableName, subLabel}` → `dispatchPrint` + `recordLastPrint` |
| Estado/token | `src/app/api/vendor/print/status/route.ts`, `.../token/route.ts` | GET status (autogenera token si falta), POST regenera |
| Perfil vendor | `src/app/api/vendor/me/route.ts` | Guarda `print_mode` |
| Historia del pedido | `src/app/api/vendor/orders/[id]/route.ts` | `GET` pedido individual (para el fallback) |
| Relay | `services/print-bridge/` | HTTP :8791 (`/health`, `/status?token=`, `/push`) + WS `/printbridge?token=` |
| App Android | `android/` (+ plugin `portal-socket`) | Conecta saliente al relay, imprime por TCP, descubre impresoras en la LAN. El WS vive **en Java** (`PortalPrintService`, OkHttp), por lo que persiste en segundo plano |
| Agente PC | `services/print-agent/agent.mjs` | Lo mismo que la app pero para Windows/Linux/macOS (EXE portable, generado con `bun build --compile`); sirve para el mostrador con impresora LAN |
| UI dashboard | `src/components/dashboard/dashboard-gastro.tsx` | Selector de modo (App/Server), estado del agente, token, botones de descarga APK + EXE del PC, test |
| Fallback | `src/app/vendor/imprimir/[id]/page.tsx` | Impresión por el equipo (ventana print del navegador, 58/80mm) cuando no hay térmico configurado |

Detalles técnicos clave:

- `dispatchPrint` elige el modo con `vendor.print_mode === "app" ? "app" : "server"` (default `server`).
- `pushToBridge` llama a `PRINT_BRIDGE_URL` + `/push` con header `x-bridge-secret` y timeout 20s.
- El fallback por sistema se abre automáticamente si el térmico devuelve error
  (`comanda-kds.tsx` y `order-detail-modal.tsx` hacen `window.open("/vendor/imprimir/<id>")`).

## Base de datos

Migración: `supabase/self-host/migrate-print-bridge.sql`. Agrega a `vendors`:

| Columna | Tipo | Default | Uso |
|---|---|---|---|
| `print_mode` | text | `'server'` | `'server'` (TCP VPS) o `'app'` (relay) |
| `print_token` | text | — | Token del comercio para la app (`pp_...`) |
| `last_print_at` | timestamptz | — | Última impresión |
| `last_print_ok` | boolean | — | Resultado |
| `last_print_error` | text | — | Error, si hubo |

**Estado: aplicada en producción** (verificado con `\d vendors` en `portal659-db`).

Aplicación (server host):
```bash
docker exec -i portal659-db psql -U portal659 -d portal659 < /opt/portal659/supabase/self-host/migrate-print-bridge.sql
# o copiando el archivo al contenedor:
docker cp supabase/self-host/migrate-print-bridge.sql portal659-db:/tmp/migrate.sql
docker exec -i portal659-db psql -U portal659 -d portal659 -f /tmp/migrate.sql
```
> El archivo vive en el host en `/opt/portal659/...`, **no** dentro del contenedor (por eso el primer
> intento con `docker exec ... -f supabase/self-host/...` da "No such file or directory").

## Configuración de producción

### Envs (compose/`.env`)
| Variable | Ejemplo | Uso |
|---|---|---|
| `PRINT_BRIDGE_URL` | `http://printbridge:8791` | El app llama al relay por la red interna Docker |
| `PRINT_BRIDGE_SECRET` | `openssl rand -hex 24` | Secreto compartido app↔relay (`x-bridge-secret`) |

### docker-compose.yml
Servicio `printbridge` (imagen `services/print-bridge/Dockerfile`, node:20-alpine), `expose 8791`,
healthcheck en `/health`. El app lleva `PRINT_BRIDGE_URL`/`PRINT_BRIDGE_SECRET` por env.

### nginx.conf
`location /printbridge` con headers de **upgrade** WebSocket hacia `http://printbridge:8791`
(lo golpean los celulares con la app — conexión saliente, no abren puertos).

### Secrets de GitHub
`PRINT_BRIDGE_SECRET` (obligatorio). El `deploy.yml` escribe el `.env` del VPS; si el secret está
vacío, ahora genera uno al azar con `openssl` para no dejar el relay sin auth.

## Prueba sin impresora (E2E del relay)

Ver `services/print-bridge/README.md`. El test levanta un **servidor TCP de captura** en
`127.0.0.1:9999`, se conecta como una app real y recibe el job:

```bash
# terminal 1 — relay
PRINT_BRIDGE_SECRET=dev npm start          # en services/print-bridge

# terminal 2 — agente falso que imprime a capturador TCP
node test/client.mjs --server ws://localhost:8791 --token dev-token

# terminal 3 — enviar un job
curl -s -X POST http://localhost:8791/push \
  -H "content-type: application/json" -H "x-bridge-secret: dev" \
  -d '{"token":"dev-token","job":{"type":"test","payload":"SG9sYQ==","printerIp":"127.0.0.1","printerPort":9999,"width":48}}'
```

Resultado esperado: `{"ok":true,"jobId":"...","offline":false}` y el capturador recibe los bytes.
(`npm run e2e` en `services/print-bridge` corre esto automáticamente: **PASS verificado**.)

La app es la misma por relay que el agente PC (mismo protocolo y token); el agente PC tiene E2E propio: `cd services/print-agent && node test/e2e.mjs`.

## Cola de impresión

Si la app/agente están desconectados, `/push` ya no pierde el pedido: **encola** (interno, por token, hasta 100 por comercio) y responde `{ok:true, queued:true}`. Cuando el cliente se reconecta, el relay le manda los pendientes en orden (FIFO). reintentos con backoff 5s entre fallos de impresión; descarta tras 8 fallos (para no atasur). El índice de cola aparece en `GET /status?token=...` como `queued`.

**Vive en memoria** del relay: un `docker restart` del contenedor `printbridge` vacía la cola. No crítico para la mayoría de comercios (un ticket perdido por reinicio del VPS es raro); si después lo necesitamos persistir, basta serializar `pending` a un volumen.

## Estado del deploy

Al día de la fecha en el VPS:

- `docker image ls` muestra `portal659-printbridge` construida (03:42 UTC) → el workflow de GitHub
  llegó a buildear el relay.
- **No hay contrato printbridge creado** y `app`/`nginx` siguen con imagen vieja: el
  `docker compose up -d --build` **murió a mitad del build de la app** (build de Next.js en un VPS de
  1GB → OOM o el `command_timeout: 30m` del `appleboy/ssh-action`).
- El sitio sigue arriba con el código anterior (sin fallas), solo que sin la feature.

Para terminarlo (en el VPS):
```bash
cd /opt/portal659
docker compose up -d --build printbridge db nginx
docker compose up -d --build app          # 15-30 min; si muere por OOM, agregar swap (abajo)
```

Swap de emergencia (disco ~19GB, ya 70% usado; 2G alcanza):
```bash
fallocate -l 2G /swapfile2 && chmod 600 /swapfile2 && mkswap /swapfile2 && swapon /swapfile2
echo '/swapfile2 none swap sw 0 0' >> /etc/fstab
```

Con el fix de `deploy.yml` (60m + swap automático + secret autogenerado), el **prójimo push** a
`master` debería completar el deploy él solo.

### Verificación después del deploy
```bash
cd /opt/portal659 && docker compose ps                       # deben estar app, db, nginx, printbridge
docker image ls | grep portal659-app                         # timestamp reciente
docker exec portal659-nginx grep -c printbridge /etc/nginx/conf.d/default.conf   # 1
docker exec portal659-printbridge wget -qO- http://localhost:8791/health         # {"ok":true}
curl -s -o /dev/null -w '%{http_code}' https://www.portal659.com.ar/printbridge # 426/400 (NO 404)
grep -E 'PRINT_BRIDGE' /opt/portal659/.env
# ojo: NO existe /api/print/health; 404 en esa ruta es esperado
```

## Checklist de prueba cuando llegue la impresora

Hardware:
- [ ] TP85-NET con cable Ethernet a la misma red del local (y del celular).
- [ ] Obtener su IP (ej. `192.168.1.100`), puerto 9100 estándar. El modo Ethernet/ESC/POS de la impresora.

Software:
- [ ] Deploy en producción terminado (ver arriba).
- [ ] Dashboard → Impresora → modo **"App en tu celu"** → copiar token.
- [ ] Compilar el APK siguiendo `android/README.md` (requiere Android SDK / JDK 17 en la PC).
- [ ] En la app: servidor `https://www.portal659.com.ar`, token, IP de la impresora (o `🔍 Buscar`), puerto 9100.
- [ ] `🖨️ Imprimir prueba` desde el dashboard (verifica relay → app → TCP → impresora).
- [ ] Comanda real de un pedido (emitir pedido de prueba) → se imprime sola o con el botón 🖨️.
- [ ] Fallback: probar `/vendor/imprimir/[id]` (print del navegador) y que aparezca en 80mm/58mm.

## Troubleshooting

| Síntoma | Causa probable | Solución |
|---|---|---|
| Deploy en GitHub se corta a mitad | Build de Next.js en VPS 1GB (OOM) o `command_timeout` 30m | Swap 2G (ver arriba); `deploy.yml` ya lo cubre (60m + swap auto) |
| `docker compose up` muere con `Killed`/`exit 137` | OOM | Agregar swap y reintentar `docker compose up -d --build app` |
| Impresión devuelve `403` | `PRINT_BRIDGE_SECRET` vacío/distinto entre app y relay | Setear el mismo valor en `.env` y GitHub; `docker compose up -d app printbridge` |
| `offline: true` | La app no está conectada al WS (no abierta / token mal) | Abrir Portal Print en primer plano, verificar token e IP |
| `curl https://.../printbridge` da 404 | nginx/contenedor viejo (deploy sin terminar) | Terminar el deploy; al estar OK da 426/400 |
| El relay no arranca | falta `PRINT_BRIDGE_SECRET` | Setearlo (el health no exige auth, pero `/push`/`/status` sí) |

## Referencias

- `services/print-bridge/README.md` — protocolo del relay (`/push`, `/status`, WS).
- `android/README.md` — build del APK y configuración de la app.
- `docs/PRODUCCION.md`, `AGENTS.md` — envs y checklist de producción.