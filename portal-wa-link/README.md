# Portal Wa Link — APK del relay WhatsApp

App Android **nativa (Kotlin)** que corre el relay `whatsmeow` (Go) en el celular
del comercio y lo conecta al cerebro (`services/wa-bot`) en el VPS. El comercio la
instala, pega su `WA_TOKEN` (del pareo en su panel) y listo: la sesión de WhatsApp
queda como "dispositivo vinculado" con la IP móvil del celular.

## Responsabilidades

- `MainActivity` — pantalla de configuración + estado + código de pareo.
- `RelayService` — ForegroundService que ejecuta el binario Go, lo vigila y lo
  reinicia con backoff (WakeLock parcial + notificación fija).
- `BootReceiver` — arranca el relay al encender el teléfono si estaba activo.

## Build

Requisitos: JDK 17, Android SDK (build-tools 36), Go (para el relay). Mismo
entorno que `portal659-twa`.

```bash
# Android (arm64, sin CGO):
CGO_ENABLED=0 GOOS=android GOARCH=arm64 go build -ldflags="-s -w" -o jniLibs/arm64-v8a/librelay.so .
```

El binario queda en `app/src/main/jniLibs/arm64-v8a/librelay.so` y cuando installás
la app Android lo encuentra en `nativeLibraryDir` (funciona con SELinux, sin necesidad
de exec en filesDir).


> Para firmar con el keystore de Portal 659, agregar `signingConfigs` a
> `app/build.gradle` apuntando a `C:\Users\IPS\portal659-keystore\portal659-release.keystore`
> (alias `portal659`), igual que se hace con el APK de impresión.

## Flujo de uso (comercio)

1. En el panel de Portal 659 → "Bot de WhatsApp" → "Conectar" → copia el `token`.
2. Abre Portal Wa Link → pega `token` y URL del relay → "Iniciar".
3. La app muestra el **código de pareo / QR** (desde el stdout del relay).
4. En WhatsApp del comercio: **Ajustes → Dispositivos vinculados → Vincular** y
   escanea/ingresa el código. Queda `LINKED`.
5. El bot responde solo; el dueño sigue viendo todo en su WhatsApp normal.

## Desactivar / matar

- Botón "Detener" de la app, o
- Toggle "Bot OFF" del admin en `/admin/comercios` (kill switch server-side).

## Distribución

APK **sideload** (no Play Store), igual que Portal Print: firmado y publicado en
`public/downloads/`. Requiere permitir "batería sin restricciones" en primer uso.