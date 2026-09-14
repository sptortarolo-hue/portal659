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