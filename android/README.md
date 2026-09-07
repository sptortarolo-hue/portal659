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

- El WebSocket del relay y la impresión TCP viven **en Java** (`PortalPrintService`), no en la
  WebView. Por eso **funciona en segundo plano** con la pantalla apagada o la app cerrada.
- **WakeLock + WifiLock + START_STICKY**: el proceso no se duerme ni se corta la red.
- **Notificación fija** ("Portal Print activo") — Android no la mata por batería.
- **Cola de jobs** en el relay: si el celu está caído, los pedidos se acumulan y al reconectar llegan en orden.
- **BootReceiver**: al encender el celular se reconecta solo (salvo que hayas tocado "Detener").
- Reconexión con backoff dentro del servicio nativo.

Requisitos del día a día:
- El celular en el **mismo Wi-Fi** que la impresora (recomendado **enchufado**).
- La app **no necesita quedar abierta en primer plano**: con el servicio iniciado, imprime igual en segundo plano.

## Estructura

```
android/
├─ portal-socket/        plugin Capacitor "PortalSocket"
│  ├─ src/               TS (definiciones + registro)
│  └─ android/           Java: PortalPrintService (WS OkHttp + TCP), PortalSocketPlugin, BootReceiver
├─ src/main.ts           UI: config token/IP, iniciar/detener, estado en vivo
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

- Desactivar la optimización de batería para "Portal Print" (el primer arranque lo pide solo).
- En algunos fabricantes (Xiaomi, Samsung, Huawei) habilitar **autostart / "sin restricciones"**.

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