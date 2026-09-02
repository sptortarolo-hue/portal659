# Portal Print — app Android (puente de impresión)

App Android (Capacitor + plugin de sockets propio) que imprime a la impresora térmica
(Union TP85-NET, Ethernet 58/80mm) por TCP en la red local. Se conecta **saliente** al relay
`services/print-bridge`, por lo que **no hace falta abrir puertos en el router ni IP pública**:
funciona detrás de NAT/CGNAT y con IP dinámica.

## Cómo se distribuye hoy
**Descargá el APK desde la app web**: dashboard del comercio → sección **Impresora** → botón
"📥 Descargar la app (Android)" (URL: `https://www.portal659.com.ar/downloads/portal-print.apk`).
Está firmado con una keystore estable; no hace falta compilar nada local.

## Funcionamiento

- El celular se **conecta solo al relay** con el token (misma red por WS) e imprime los pedidos.
- **Autorreconexión** con backoff exponencial (1s → 30s máximo) + guardián de reconn cada 10s si el
  relay está cerrado.
- **ForegroundService**pone la **notificación fija** en la barra ("Portal Print activo") — Android ya
  no la mata por batería.
- **Array de jobs pendientes** en el relay: si la app está caida, los pedidos se acumulan y al reconectar
  llegan en orden.
- **Arranque al encender el celular**: si reiniciás el celular, el sistema levanta el FG service
  solo; la notificación aparece y al tocarla abre la app (y al abrir la app se reconecta solo).

Requisitos del día a día:
- El celular en el **mismo Wi-Fi** que la impresora.
- La app idealmente **en primer plano** en el mostrador (enchufada) — los pedidos confirmados se
  imprimen solos. Con el FG service también funciona si la minimizás.

## Estructura

```
android/
├─ portal-socket/        plugin Capacitor "PortalSocket" (TCP + descubrimiento + FG service)
├─ src/main.ts           lógica de la app (relay WebSocket + impresión)
└─ www/                  índice y estilos (web asset de Capacitor)
```

## Estructura

```
android/
├─ portal-socket/        plugin Capacitor "PortalSocket" (TCP + descubrimiento en la LAN)
│  ├─ src/index.ts       registro del plugin (TS)
│  ├─ src/definitions.ts API del plugin
│  └─ android/           implementación Java (Socket / discover / keepAwake)
├─ src/main.ts           lógica de la app (relay WebSocket + impresión)
└─ www/                  índice y estilos (web asset de Capacitor)
```

## Compilar el APK (una sola vez)

Requisitos de la máquina de build:

- Node.js 18+ y npm
- JDK 17
- Android Studio (o CLI de Android SDK) con Android SDK (API 34)

```bash
cd android

# 1) dependencias + web bundle
npm install
npm run build

# 2) generar la plataforma android (solo la primera vez)
npx cap add android

# 3) sincronizar web + plugin
npm run sync

# 4) compilar/instalar en el celular por USB
npm run apk
# o abrir en Android Studio y Build > Build APK(s):
#   npx cap open android
```

El APK resultante se instala con orígenes desconocidos habilitados. Recomendado además:

- Desactivar la optimización de batería para "Portal Print" (Ajustes → Batería).
- Usar la app en modo pantalla siempre encendida (ya se hace solo con `PortalSocket.keepAwake`).

## Configuración en la app

| Campo | Valor |
|---|---|
| Servidor | `https://www.portal659.com.ar` (o tu dominio) |
| Token | el de la sección **Impresora** del dashboard del comercio (modo "App en tu celu") |
| IP impresora | el botón **🔍 Buscar** la detecta en la red automáticamente, o escribila a mano (la de la TP85, ej. `192.168.1.100`) |
| Puerto | `9100` (default de las impresoras ESC/POS de red) |

Los pedidos llegan como **buffer ESC/POS ya armado por el servidor** (un solo generador de
tickets en `src/lib/thermal-printer.ts`); esta app solo los entrega por TCP y responde el ack.

## Notas

- El plugin `PortalSocket.print` conecta al puerto 9100 con timeout de 5s y devuelve bytes enviados.
- `PortalSocket.discover` escanea el /24 de la red activa (se obtiene la subred del Wi-Fi actual).
- El web fallback (`src/web.ts`) permite abrir la app en un navegador solo para ver la UI;
  la impresión requiere el build nativo.