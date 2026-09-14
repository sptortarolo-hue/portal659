# Portal Print Agent (PC — Windows)

Programa que recibe los tickets del portal y los manda a la impresora térmica ESC/POS
directamente por la red local (TCP 9100). Es el equivalente en PC de la app Android
"Portal Print": ambos se conectan al mismo relay con el mismo token.

A diferencia de la primera versión (que corría en una ventana CMD), ahora es una app de
escritorio (Electron) con **ventana de configuración** y **bandeja del sistema**.

## Para el comercio (uso directo, sin instalar nada)

1. Descargá `portal-print-agent.exe` desde el dashboard:
   sección **Impresora → 💻 Descargar para PC (Windows)**.
2. Doble clic al archivo (portable: no instala nada, no pide permisos de administrador).
3. En la ventana pegá el **token** (del dashboard) y la **IP de la impresora**, y tocá **Guardar**.
4. Tocá **Probar impresora** para verificar.
5. Activá **"Arrancar al encender la PC"** si querés que empiece solo al iniciar Windows.

- Al cerrar la ventana, el agente **sigue imprimiendo** desde la bandeja del sistema (ícono
  junto al reloj). Para salir del todo: menú de la bandeja → **Salir**.
- Si cambia la IP o el token, abrí la ventana desde la bandeja, editá y **Guardar**.

> Nota: la primera vez Windows puede mostrar SmartScreen ("Windows protegió tu PC") por ser
> un .exe sin firmar. Es normal: "Más información → Ejecutar de todas formas". Se elimina
> definitivamente firmando el .exe con un certificado de firma de código (OV).

## Para desarrolladores

- Código fuente:
  - `agent.mjs` — variante headless (sin GUI, legacy; la usa el test E2E).
  - `src/main.js` — proceso principal Electron (ventana, bandeja, IPC, autostart).
  - `src/relay.js` — lógica WebSocket → impresora TCP.
  - `src/renderer/*` — HTML/CSS/JS de la ventana.
- Requiere `npm install` (devDeps: electron + electron-builder; dep: ws).
- Correr en dev: `npm run start:electron`.
- Test unitario de validación/estado: `npm test`.
- Build del EXE portable: `npm run build:exe` → sale en `dist/portal-print-agent.exe`.
- La ventana muestra la versión instalada (`v2.0.0`), el servidor intentado, el último error y el reintento pendiente.
- Icono: `scripts/make-ico.mjs` genera `assets/icon.ico` desde `assets/icon-512.png`.
- Test E2E (relay real + agente headless + capturador TCP): `node test/e2e.mjs`.

## Publicar el exe en el VPS

El `.exe` **no se versiona** (`.gitignore`). Tras el build, subirlo al volumen de uploads:

```
scp -P 8277 dist/portal-print-agent.exe <VPS_USER>@<VPS_HOST>:/tmp/
ssh -p 8277 <VPS_USER>@<VPS_HOST> "docker cp /tmp/portal-print-agent.exe portal659:/app/uploads/downloads/"
```

Si ya hay clientes con el exe viejo cacheado, bumpear el `?v=` del link en
`dashboard-gastro.tsx` (hoy `?v=2`).