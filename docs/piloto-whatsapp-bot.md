# Piloto — Bot de pedidos por WhatsApp (Portal 659)

Bot que toma pedidos por WhatsApp y los crea en el dashboard del comercio.
El motor de WhatsApp (whatsmeow) corre en un **APK** en el celular del comercio
(IP móvil/residencial); el **cerebro** (estados + NLU + creación de pedido) vive
en el VPS. Este documento registra **qué se agregó** para poder **borrarlo
completo** si el piloto no funciona.

**Estado:** Fase 1 (núcleo server: `createOrder`, endpoints `wa/*`, toggle admin,
migración) implementada y verificada (`tsc` + `build`). Fases 2/3 compiladas y
firmadas: relay Go → `relay-arm64` (CGO_ENABLED=0) y APK "Portal Wa Link"
(`portal-wa-link/app/build/outputs/apk/release/app-release.apk`, firmado con
`portal659-release.keystore`). Migración `vendor_wa_bots` aplicada al Postgres
local; `WA_BOT_SECRET` setado en `.env.local` y plumbado en `deploy.yml` (auto
genera si falta el secret). Smoke test local del cerebro OK (relay WS + vendor +
reply). **Anti-ban** (pacing humano, tipeo, rate limits, backoff de re-pareo)
integrado en cerebro + relay; APK `?v=12`. Falta solo lo remoto/real: correr la
migración en el VPS, setear `WA_BOT_SECRET` (secret de GitHub o auto), y vincular
un número real desde el APK.

---

## 1. Qué se agregó (inventario)

### Base de datos (1 tabla)
- `vendor_wa_bots` — vínculo comercio ↔ número/relay, con `enabled` (kill switch).
  Migración: `supabase/self-host/migrate-pilot-whatsapp-bot.sql`.

### Código nuevo (nuevo, se borra directo)
- `src/lib/order-service.ts` — `createOrder()` compartido (web + bot).
- `src/lib/wa-bot.ts` — helpers de auth (`WA_BOT_SECRET`) + kill switch.
- `src/app/api/wa/menu/route.ts` — menú público para el bot.
- `src/app/api/wa/order/route.ts` — crear pedido desde el bot.
- `src/app/api/vendor/wa-bot/route.ts` — pareo self-service del comercio
  (generar/regenerar/ver token, toggle propio).
- `src/app/vendor/wa-bot/page.tsx` — página del comercio con el token/estado.
- `services/wa-bot/` — cerebro Node (relay WS + estados Redis + NLU NIM) y relay
  `whatsmeow` (Go) + README.
- `portal-wa-link/` — APK nativo Kotlin "Portal Wa Link" (ForegroundService +
  BootReceiver + exec del relay Go + UI de pareo).

### Código modificado (revertir estos bloques si se borra)
- `src/app/api/orders/route.ts` — ahora delega en `createOrder` (sin cambio de
  comportamiento; refactor limpio).
- `src/app/api/admin/comercios/route.ts` — acción `toggle_wa_bot` + campo
  `wa_bot_enabled` en GET.
- `src/app/admin/comercios/page.tsx` — botón "Bot ON/OFF" por comercio.
- `src/components/vendor/vendor-sidebar.tsx` — enlace "Bot de WhatsApp" en el pie.
- `nginx.conf` — `location /wa` (relay WS del APK) debajo de `printbridge`.

### Config / deploy
- Env nueva: `WA_BOT_SECRET` (en app y en `wabot`).
- `docker-compose.yml`: servicio `wabot` (cerebro, `mem_limit: 256m`) + `WA_BOT_SECRET`
  agregado al `app`.

---

## 2. Migración (correrla contra el contenedor)

```bash
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-pilot-whatsapp-bot.sql
```

(usuario/db por defecto `portal659`; ajustar a `POSTGRES_USER`/`POSTGRES_DB` si difieren).

---

## 3. Kill switch (apagar el bot sin borrar nada)

Hay **tres niveles**, de más fino a más bruto:

1. **Por comercio (admin):** `/admin/comercios` → botón **"Bot OFF"**. Pone
   `vendor_wa_bots.enabled = false`. El servicio respeta `enabled` en cada
   mensaje entrante y el endpoint `/api/wa/order` lo valida también.
2. **Apagar el servicio:** `docker compose stop wabot` (el bot deja de responder;
   la web sigue igual).
3. **Cortar el canal:** quitar `WA_BOT_SECRET` del env + desvincular el
   dispositivo desde el WhatsApp del comercio (Ajustes → Dispositivos
   vinculados → quitar).

## 3.1. Publicar el APK (Plan B — sin versionar el binario)

El APK **no se commitea** (salvo `public/downloads/portal-wa-link.apk`, el build
firmado que ya sirve el panel con cache-bust `?v=N`). Para un build nuevo, además
de recompilar el relay hay que copiarlo al volumen `uploads_data` del VPS (el
route `/uploads/*` sirve cualquier archivo con `must-revalidate`, igual que el
agente PC):

```bash
# 1) Publicar el APK compilado (portal-wa-link, firmado) en el VPS:
scp -P 8277 portal-wa-link/app/build/outputs/apk/release/app-release.apk root@<TU_VPS>:/tmp/portal-wa-link.apk
ssh -p 8277 root@<TU_VPS> "docker exec portal659 mkdir -p /app/uploads/downloads && docker cp /tmp/portal-wa-link.apk portal659:/app/uploads/downloads/portal-wa-link.apk"

# 2) La descarga para el comercio ya está en su panel (/vendor/wa-bot):
#    https://www.portal659.com.ar/uploads/downloads/portal-wa-link.apk?v=1
```

> Como el archivo se sobreescribe in-place (misma URL), usá `?v=N` en el link cada
> vez que subas un build nuevo (cache-bust).
>
> Para borrarlo del piloto: `docker exec portal659 rm /app/uploads/downloads/portal-wa-link.apk`.

---

## 3.2. Anti-ban (qué se hizo y qué se puede tunear)

whatsmeow es un cliente **no oficial** → el ban es un riesgo real (ToS). El
diseño ya era conservador (relay en el celular del comercio, IP móvil; el bot
**solo responde** a inbound, nunca inicia conversaciones; kill switch por
comercio). Esta tanda agregó señales humanas + frenos automáticos:

| Medida | Dónde | Tune |
|---|---|---|
| Delay humano antes de responder (base 1200–3500ms + ~4ms/char) | `index.mjs` (`humanDelay`) | `WA_REPLY_DELAY_MIN_MS`/`MAX_MS` |
| Gap entre replies múltiples | `index.mjs` | `WA_REPLY_GAP_MS` |
| Indicador de tipeo (el dueño "escribe") | cerebro → relay `SendChatPresence` | — (siempre activo) |
| Cap mensajes salientes por hora/día | `src/limits.mjs` | `WA_MAX_MSG_PER_HOUR`/`DAY` |
| Cap chats NUEVOS por hora (anti avalancha) | `src/limits.mjs` | `WA_MAX_NEW_CHATS_PER_HOUR` |
| Plantilla de menú variada (no blob idéntico) | `src/menu.mjs` | — |
| Backoff de re-pareo tras `logged_out` (5s→5min) | relay `main.go` | `WA_REPAIR_BACKOFF_MAX` |
| Telemetría `/health` (`stats`, límites) + logs `[ban-risque]` | `index.mjs` | — |

Al superarse un cap, el bot hace **handoff** (responde el dueño) y loguea
`[ban-risque]`. Todas las env son opcionales (defaults conservadores) y van al
servicio `wabot` del compose.

> **Recomendación de fondo:** si el número principal del comercio es crítico,
> correr el bot en un **número dedicado** (SIM nueva). Un ban mata el número que
> hospeda la sesión; con número dedicado se pierde el bot, no el negocio.

---

## 4. Borrado TOTAL (deshacer todo, volver al estado previo)

1. **Contenedor**
   ```bash
   docker compose stop wabot
   ```
   Sacar el bloque `wabot` de `docker-compose.yml`.

2. **Base de datos**
   ```bash
   docker exec -i portal659-db psql -U portal659 -d portal659 -c "DROP TABLE IF EXISTS vendor_wa_bots;"
   ```

3. **Código — borrar archivos**
   - `src/lib/order-service.ts`
   - `src/lib/wa-bot.ts`
   - `src/app/api/wa/` (directorio completo)
   - `services/wa-bot/` (directorio completo)
   - `portal-wa-link/` (directorio completo)

4. **Código — revertir bloques en archivos existentes**
   - `src/app/api/orders/route.ts`: volver la versión anterior (o `git checkout`
     del archivo; el refactor no cambió comportamiento).
   - `src/app/api/admin/comercios/route.ts`: quitar `toggle_wa_bot` y el merge
     de `wa_bot_enabled`.
   - `src/app/admin/comercios/page.tsx`: quitar `wa_bot_enabled`, `handleToggleWaBot`
     y el botón "Bot ON/OFF".

5. **Env** — quitar `WA_BOT_SECRET` de `.env.local`, del `environment:` del
   compose y de los secrets de prod.

6. **Celular** — desinstalar el APK "Portal Wa Link" y, en el WhatsApp del
   comercio: **Ajustes → Dispositivos vinculados → quitar** el dispositivo.

7. **Reiniciar**
   ```bash
   docker compose up -d
   ```

El WhatsApp del comercio nunca dejó de funcionar (era un dispositivo vinculado).

> Nota: si se borra sin correr la migración del paso 2, o al revés (se corre la
> migración y no se borra la tabla), no pasa nada: el código tolera la tabla
> inexistente (`wa-bot.ts`), y una tabla vacía no molesta.

---

## 5. Criterios de éxito del piloto (go / no-go)

- 0 logout/ban inesperados durante la ventana de prueba.
- ≥ 8/10 pedidos de prueba interpretados y creados correctamente en el dashboard.
- El dueño no pierde ningún pedido (lo sigue viendo en su WhatsApp normal).
- Contenedor `wabot` (`services/wa-bot`) no supera su `mem_limit` ni afecta a
  `app`/`db`.
- El kill switch (toggle admin) funciona: con `Bot OFF` el bot deja de responder.

Si falla algún criterio duro → runbook de la sección 4.