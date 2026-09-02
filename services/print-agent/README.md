# Portal Print Agent (PC — Windows/Linux/macOS)

Programa que recibe los tickets del portal y los manda a la impresora térmica ESC/POS
directamente por la red local (TCP 9100). Es el equivalente en PC de la app Android
"Portal Print": ambos se conectan al mismo relay con el mismo token.

## Para el comercio (uso directo, sin instalar nada)

1. Descargá `portal-print-agent.exe` desde el dashboard:
   sección **Impresora → 💻 Descargar para PC**.
2. Doble clic al archivo.
3. La primera vez pregunta: **token** (lo copiás del dashboard, lo ves abajo de esa sección) y
   **IP de la impresora** (la TP85 la muestra en su ticket de autotest; suele ser 192.168.1.x).
4. A partir de ahí, cada vez que el archivo se ejecute, imprime solo.

- Si cambia la IP de la impresora o el token: `portal-print-agent.exe --setup`.
- Para que arranque al prender la PC:
  ```
  Win + R  →  shell:startup  →  pegá el .exe ahí
  ```
  o programá una tarea:
  ```
  schtasks /create /tn "Portal Print" /sc onlogon /rl highest /tr "\"C:\ruta\portal-print-agent.exe\""
  ```

## Para desarrolladores

- Código fuente: `services/print-agent/agent.mjs` (Node 22+ con WebSocket global nativo, sin npm install).
- Build del EXE: `bun build agent.mjs --compile --target=bun-windows-x64 --outfile portal-print-agent.exe`.
- Test E2E (relay real + agente + capturador TCP): `node test/e2e.mjs` desde esta carpeta.
