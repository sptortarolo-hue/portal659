# Portal Print Agent (Windows/Linux/macOS)

Versión de PC del puente de impresión. Levanta el mismo WebSocket al relay de Portal 659
que la app Android y manda los jobs ESC/POS al TCP 9100 de la impresora en la LAN.

## Requisitos

- Node.js >= 22 (tiene WebSocket global, sin npm install).
- La impresora (ej. Union TP85-NET) en la misma red que la PC, TCP 9100 abierto.

## Configurar

1. Copiá `agent.config.example.json` → `agent.config.json` en la misma carpeta y editá:
   - `token`: el de la sección **Impresora** del dashboard del comercio (modo "App en tu celu" funciona igual, el PC y el celular pueden compartir el mismo token — cada uno es un cliente del relay; ambos reciben los jobs).
   - `printerIp`: la IP de la impresora en la red (ej. `192.168.1.100`). La TP85 la reporta al encender en su propio ticket de autotest, o probá `192.168.x.100...` en la consola si está con DHCP con reserva.
   - `printerPort`: `9100` (default ESC/POS).

## Probar manual

```
node agent.mjs
```

Deberías ver `[agent] conectado al relay`. Luego probá "Imprimir prueba" desde la sección
Impresora del dashboard — el ticket sale por la impresora.

## Que arranque solo al prender la PC

**Opción A — carpeta Inicio (más simple):**
1. Presioná `Win + R`, escribí `shell:startup` y Enter.
2. Copiá `autostart.bat` ahí (o atajo).
3. Reiniciá — el agente aparece minimizado al abrir sesión.

**Opción B — Task Scheduler (más robusto, sin carpeta Inicio):**
```
schtasks /create /tn "PortalPrintAgent" /sc onlogon /rl highest /tr "\"C:\ruta\a\node.exe\" \"C:\ruta\print-agent\agent.mjs\""
```
(corre sin mostrar la ventana si apuntás a `node.exe` directamente con `wscript` o con un .vbs wrapper).

## Sin Node instalado: EXE único

Desde esta misma carpeta, con Bun instalado en tu PC de trabajo:
```
bun build agent.mjs --compile --outfile portal-print-agent.exe
```
El `.exe` resultante es standalone (sin Node): basta ponerlo con el `agent.config.json` al lado.

## Nota

El agente NUNCA imprime nada por sí solo; solo recibe jobs del relay (`/push`) y los ejecuta.
Idem al app Android, es seguro tener ambos live a la vez (mismo token): el relay entrega de forma
mutable a cualquiera de los conectados por token — el primero que lo toma lo imprime.
