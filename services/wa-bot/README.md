# WhatsApp Bot (Portal 659) — relay + cerebro

Bot que toma pedidos por WhatsApp y los crea en el dashboard del comercio.

Dos piezas:
1. **`relay/`** — relay **whatsmeow (Go)** que corre dentro del APK "Portal Wa
   Link" en el celular del comercio. Mantiene la sesión de WhatsApp (IP móvil) y
   reenvía mensajes al cerebro por WebSocket.
2. **`index.mjs` + `src/`** — **cerebro (Node)** en el VPS: máquina de estados
   (Redis), NLU (NVIDIA NIM) y creación de pedido llamando a `/api/wa/order` del
   app Next.

## Arquitectura

```
APK (relay Go / whatsmeow)
  └─ WS outbound → ws://<vps>:8792/wa?token=<vendor_wa_bots.token>
        sube {type:"message", wa_id, body}
        recibe {type:"send", wa_id, text}

VPS — services/wa-bot (cerebro, Node)
  ├─ WS server /wa (patrón print-bridge)
  ├─ vendorByToken() → vendor + enabled (kill switch)
  ├─ estado de conversación (Upstash Redis, fallback memoria)
  ├─ NLU (NVIDIA NIM) + match nombre→producto
  ├─ GET /api/wa/menu  /  POST /api/wa/order  (app Next, Bearer WA_BOT_SECRET)
  └─ respuestas por WS al relay
```

## Cerebro (Node)

```bash
cd services/wa-bot
cp .env.example .env   # setear WA_BOT_SECRET, DATABASE_URL, UPSTASH_*, LLM_API_KEY
npm install
npm start             # escucha :8792 (WS /wa + GET /health)
```

Se despliega con Docker (`docker-compose.yml` → servicio `wabot`, `mem_limit: 256m`).

## Relay (Go) — compilar para Android

```bash
cd services/wa-bot/relay
go mod tidy                                  # resuelve whatsmeow + deps
CGO_ENABLED=0 GOOS=android GOARCH=arm64 go build -ldflags="-s -w" -o relay-arm64 .
CGO_ENABLED=0 GOOS=android GOARCH=amd64 go build -ldflags="-s -w" -o relay-x86_64 .
```

El relay usa `modernc.org/sqlite` (driver sqlite PURO Go) → **sin CGO, sin NDK**.

Requisitos del relay (env):
- `WABOT_URL` / `VPS_WS_URL` — WebSocket del cerebro (`ws://<vps>:8792/wa`).
- `WA_TOKEN` — `vendor_wa_bots.token` del comercio.
- `SESSION_DIR` — carpeta de sesión (default `./session`).
- `--login` — borra sesión y regenera el pairing code.

### Wrapper Kotlin (APK "Portal Wa Link")

Vive en `portal-wa-link/` (repo). Embebe el binario `relay` (arm64), lo ejecuta
como subproceso con `ForegroundService` + `BootReceiver` + exclusión de batería +
reconexión (patrón Portal Print). La UI:
- muestra el `PAIRING_CODE` que el relay imprime por stdout (`login`),
- muestra estado (`CONNECTED` / `DISCONNECTED` / `LOGGED_OUT`),
- persiste `WA_TOKEN` + URL del VPS.

> Nota: escrito contra la API actual de `whatsmeow` (proto `waE2E`, pairing-code,
> `sqlstore.NewWithDB`). Verificado contra el código fuente; si `go mod tidy`
> pineara una versión que mueve algo, es un retoque menor.

## Anti-ban (medidas para parecer humano)

whatsmeow es un cliente **no oficial** → hay riesgo de ban. El diseño ya era
conservador (el relay corre en el celular del comercio con IP móvil, el bot solo
responde a inbound, nunca inicia conversaciones, hay kill switch por comercio).
Esto suma señales anti-bot:

- **Pacing humano**: delay aleatorio antes de responder (base 1200–3500ms +
  ~4ms/char del mensaje, `WA_REPLY_DELAY_MIN_MS`/`MAX_MS`) y gap entre replies
  múltiples (`WA_REPLY_GAP_MS`). Antes todo salía en ~1s — patrón robótico.
- **Indicador de tipeo**: el cerebro manda `{type:"typing"}` antes de cada reply
  y `{type:"paused"}` al terminar; el relay emite `SendChatPresence` (el dueño
  "aparece escribiendo"). Es el refuerzo más efectivo y el que más cuesta ver.
- **Rate limits por comercio** (`src/limits.mjs`): al superar mensajes/hora
  (`WA_MAX_MSG_PER_HOUR`, 60) o /día (`WA_MAX_MSG_PER_DAY`, 500), o chats NUEVOS
  por hora (`WA_MAX_NEW_CHATS_PER_HOUR`, 15), el bot deja de responder y hace
  handoff al dueño (como el kill switch, pero automático). Estado en Redis (o
  memoria si no hay). Se loguea como `[ban-risque]`.
- **Plantilla variada**: el saludo/menú ya no es el blob exactamente idéntico a
  cada chat nuevo (`src/menu.mjs` rota saludos y pies de mensaje por comercio).
- **Backoff de re-pareo** (relay): tras un `LoggedOut`, el re-pareo espera 5s →
  duplica por cada fallo seguido hasta `WA_REPAIR_BACKOFF_MAX` (5min). Ciclos
  rápidos logout→relink parecen automatización. Se resetea al quedar vinculado.
- **Telemetría**: `/health` expone `stats` (mensajes, replies, loggedOut,
  limitsHit) y los límites activos. Cada `logged_out` loguea `[ban-risque]`.

Todas las env anti-ban son opcionales (defaults conservadores en `config.mjs` /
`main.go`). Para tunear: pasarlas al servicio `wabot` del compose.

### Si te banean / desvinculan

1. El relay avisa `LOGGED_OUT=1`, el panel pasa a `unlinked` y re-parea solo con
   backoff. Si el número se desvinculó a propósito (quitar dispositivo desde el
   WhatsApp), el re-pareo requerirá re-escanear el QR en el APK.
2. **El dueño nunca pierde su WhatsApp**: era un dispositivo vinculado; con solo
   quitar el APK (o `docker compose stop wabot`) el negocio vuelve a la normalidad.
3. Si el ban es real (número bloqueado), no hay recuperación vía whatsmeow: usar
   otro número. Por eso conviene correr el bot en un **número dedicado** si el
   principal es crítico (ver `docs/piloto-whatsapp-bot.md`).