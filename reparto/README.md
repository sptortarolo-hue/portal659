# Portal Reparto — app Android (ubicación en vivo)

App Android (Capacitor + plugin propio `reparto-location`) para que el
repartidor comparta su ubicación en vivo **con la pantalla apagada o la app
cerrada**. La web no puede hacer eso (el navegador suspende el GPS): por eso
esta app existe. El cliente ve la moto en `/seguimiento/[token]` y el local
la ve en el tablero.

## Cómo se distribuye

**El repartidor la descarga desde su vista**: módulo del repartidor
(`/vendor/dashboard` con rol delivery) → tarjeta **📲 App Portal Reparto**
(solo se muestra en Android; en iPhone muestra el respaldo por WhatsApp).
URL: `https://www.portal659.com.ar/downloads/portal-reparto.apk?v=1`
(subir `?v=` en cada release, en `delivery-board.tsx` → `RepartoAppCard`).

Firmada con el mismo keystore estable de Portal Print
(`C:\Users\IPS\portal659-keystore\portal-print-release.keystore`, NO se
versiona; `reparto/android/keystore.properties` tampoco).

## Funcionamiento

- Login con **teléfono + contraseña de repartidor** (mismo que la web;
  `POST /api/auth/repartidor/login` devuelve `session.access_token` para el
  header `Bearer`).
- Lista delivery `ready`/`sent`: Tomar / Compartir / Entregado / WhatsApp.
- **Iniciar** levanta `RepartoLocationService` (foreground,
  `foregroundServiceType="location"`): `LocationManager` (GPS + red, sin
  Play Services) → `POST /api/vendor/orders/[id]/position {lat, lng}` cada
  ~15s o 20m.
- **Auto-stop de privacidad**: si el server responde 403/404/409 (el pedido
  ya no está En camino), el servicio se detiene solo y borra el pedido.
- **WakeLock + START_STICKY + `stopWithTask=false`** + notificación fija con
  botón Detener + **BootReceiver** (retoma tras reiniciar; el primer POST da
  409 si el pedido ya terminó y se apaga solo).
- Permisos en orden Android: primero FINE+COARSE, después BACKGROUND
  ("Permitir siempre", necesario para pantalla apagada) + exención de batería
  (Xiaomi/Samsung la exigen o matan el servicio).

## Compilar (esta máquina ya tiene JDK 17 + SDK + keystore)

```powershell
cd reparto
npm install
npm run build:web
npx cap add android   # solo la primera vez (genera reparto/android/, no se versiona)
# keystore.properties + firma en app/build.gradle (ya hecho acá, ver abajo)
npm run sync
cd android
./gradlew assembleRelease
Copy-Item app/build/outputs/apk/release/app-release.apk ../../public/downloads/portal-reparto.apk -Force
```

`reparto/android/keystore.properties` (local, no versionado) apunta al
keystore de Portal Print; `app/build.gradle` ya trae el bloque
`signingConfigs.release` (se pierde si regenerás la plataforma con
`cap add` — re-aplicalo).

## Estructura

```
reparto/
├─ reparto-location/    plugin Capacitor "RepartoLocation"
│  ├─ src/               TS (definiciones + registro)
│  └─ android/           Java: RepartoLocationService, RepartoLocationPlugin, BootReceiver
├─ src/main.ts           UI: login, lista de entregas, iniciar/detener, permisos
└─ www/                  index.html + bundle (web asset de Capacitor)
```

Solo se versiona el fuente (`reparto/android/`, `node_modules/`, `www/main.js`
y `keystore.properties` están en `reparto/.gitignore`); el APK sí se
commitea en `public/downloads/portal-reparto.apk`.
