# Portal Print Agent (PC — Windows)

Programa que recibe los tickets del portal y los manda a la impresora térmica ESC/POS
directamente por la red local (TCP 9100). Es el equivalente en PC de la app Android
"Portal Print": ambos se conectan al mismo relay con el mismo token.

Es una app de escritorio (Electron) con **ventana de configuración** y **bandeja del sistema**.

## Para el comercio (uso directo, sin instalar nada)

1. Descargá `portal-print-agent.zip` desde el dashboard:
   sección **Impresora → 💻 Descargar para PC (Windows)**.
2. **Extraé** el .zip en una carpeta (clic derecho → "Extraer todo").
3. Abrí `Portal Print Agent.exe` (doble clic).
4. En la ventana pegá el **token** (del dashboard) y la **IP de la impresora**, y tocá **Guardar**.
5. Tocá **Probar impresora** para verificar.
6. Activá **"Arrancar al encender la PC"** si querés que empiece solo al iniciar Windows.

- Al cerrar la ventana, el agente **sigue imprimiendo** desde la bandeja del sistema (ícono
  junto al reloj). Para salir del todo: menú de la bandeja → **Salir**.
- Si cambia la IP o el token, abrí la ventana desde la bandeja, editá y **Guardar**.

> **AVG/Avast lo marca (IDP.HEUR.26)**: es un falso positivo heurístico (apps nuevas sin
> firma digital). Restaurá el archivo desde cuarentena, agregá una excepción por archivo
> (AVG: Configuración → General → Excepciones → `Portal Print Agent.exe`) y, si querés,
> [reportalo como falso positivo a AVG](https://www.avg.com/en-ww/report-false-positive).
> La distribución en `.zip` (carpeta, sin wrapper portable) reduce estos avisos.

## Para desarrolladores

- Código fuente:
  - `agent.mjs` — variante headless (sin GUI, legacy; la usa el test E2E).
  - `src/main.js` — proceso principal Electron (ventana, bandeja, IPC, autostart).
  - `src/relay.js` — lógica WebSocket → impresora TCP.
  - `src/renderer/*` — HTML/CSS/JS de la ventana.
- Requiere `npm install` (devDeps: electron + electron-builder; dep: ws).
- Correr en dev: `npm run start:electron`.
- Test unitario de validación/estado: `npm test`.
- La ventana muestra la versión instalada (`v2.0.0`), el servidor intentado, el último error y el reintento pendiente.
- Icono: `scripts/make-ico.mjs` genera `assets/icon.ico` desde `assets/icon-512.png`.
- Test E2E (relay real + agente headless + capturador TCP): `node test/e2e.mjs`.

### Build de distribución (carpeta .zip)

```
npm run build:win        # electron-builder --win dir → dist/win-unpacked (sin wrapper portable)
npm run package:zip      # recorta locales a es/en y arma dist/portal-print-agent.zip
npm run build:win:zip    # los dos juntos
```

`npm run build:exe` (portable) queda solo para pruebas internas; **no** es la vía de distribución
porque el wrapper portable dispara más falsos positivos de antivirus.

## Publicar el zip en el VPS

El `.zip` **no se versiona** (`.gitignore`). Tras el build, subirlo al volumen de uploads:

```
scp -P 8277 dist/portal-print-agent.zip <VPS_USER>@<VPS_HOST>:/tmp/
ssh -p 8277 <VPS_USER>@<VPS_HOST> "docker cp /tmp/portal-print-agent.zip portal659:/app/uploads/downloads/"
```

Si ya hay clientes con la versión anterior cacheada, bumpear el `?v=` del link en
`dashboard-gastro.tsx` (hoy `?v=3`).