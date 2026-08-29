# Portal Print Bridge

Relay WebSocket multi-vendor para impresión térmica ESC/POS.
Entrega a la app **Portal Print** (Android) los trabajos de impresión que genera el
servidor de Portal 659, para que la app los envíe a la impresora por TCP en la red local.

## Arquitectura

```
POST /push (interno, autenticado)  ──►  Relay  ──►  WS /printbridge?token=...  ──►  App Portal Print
                                                                                       └─ TCP 9100 ─► Impresora TP85-NET
```

- La app del comercio (misma red Wi-Fi que la impresora) se conecta **saliendo** al relay:
  no se abren puertos en el router ni hace falta IP pública — funciona detrás de NAT/CGNAT.
- El trabajo viaja como buffer ESC/POS ya armado (base64) + IP/puerto destino.
- El relay responde al servidor el resultado (`ok` | `offline` | `error`) con timeout.

## Config

Variables de entorno:

| Variable | Uso |
|---|---|
| `PORT` | Puerto del relay (default `8791`) |
| `PRINT_BRIDGE_SECRET` | Secreto compartido para `/push` y `/status` (mismo valor que en el app de Portal 659) |

## Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/health` | — | Healthcheck |
| GET | `/status?token=...` | `x-bridge-secret` | ¿La app del vendor está conectada? |
| POST | `/push` | `x-bridge-secret` | Enviar `{ token, job }`; espera ack con timeout |
| WS | `/printbridge?token=...` | token en query | Conexión de la app Portal Print |

`job`:
```json
{
  "type": "ticket" | "comanda" | "test",
  "payload": "<buffer ESC/POS en base64>",
  "printerIp": "192.168.1.100" | null,
  "printerPort": 9100,
  "width": 48
}
```

## Prueba local (sin celular)

El test levanta un **servidor TCP de captura** en `127.0.0.1:9999`, se conecta al relay como
una app de verdad, y al recibir un job escribe los bytes al capturador e imprime un resumen.

```bash
# terminal 1 — relay
PRINT_BRIDGE_SECRET=dev npm start

# terminal 2 — cliente falso (app) que imprime a los bytes recibidos
node test/client.mjs --server ws://localhost:8791 --token dev-token

# terminal 3 — enviar un job
curl -s -X POST http://localhost:8791/push \
  -H "content-type: application/json" -H "x-bridge-secret: dev" \
  -d '{"token":"dev-token","job":{"type":"test","payload":"SG9sYQ==","printerIp":"127.0.0.1","printerPort":9999,"width":48}}'
```

## Deploy

En el VPS se despliega como contenedor `printbridge` (ver `docker-compose.yml` de la raíz),
expuesto a los agentes vía nginx en `location /printbridge/` (WebSocket). El app de Portal 659
lo llama internamente con `PRINT_BRIDGE_URL=http://printbridge:8791`.