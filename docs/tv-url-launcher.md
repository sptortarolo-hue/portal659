# Pantalla TV — cómo poner la carta en un televisor

Guía interna de la **Pantalla TV**: cómo poner la carta del comercio en un
televisor sin escribir URLs largas, cómo cambiarla desde el celular y qué
opciones hay por dispositivo.

La versión corta vive **dentro del panel** (pestaña **Pantalla TV** → card
"📺 Cómo usar la Pantalla TV" → botón **Ver guía completa**). Este documento es
la versión extendida para soporte.

> **No hace falta instalar una app del Play Store.** La carta se instala como
> **PWA** (la app web del portal) desde el navegador de la tele: queda un ícono
> en el home que la abre sola y a pantalla completa.

---

## 1. Las dos URLs

| URL | Para qué | Cómo se usa |
|---|---|---|
| `https://www.portal659.com.ar/pantalla/<token>` | **La carta.** Es la que se abre en la tele. | Pegada en el navegador de la tele o instalada como app. |
| `https://www.portal659.com.ar/t/<código>` | **Link corto** (4 caracteres, p. ej. `k7f2`). Redirige a la carta. | Para tipear con el control remoto sin escribir 58 caracteres. |
| `https://www.portal659.com.ar/tv/<token>` | **Central de mando** (celular). | A donde apunta el QR del panel: desde ahí le mandás la carta a la tele. |

El QR del panel **ya no apunta a la carta**: apunta a `/tv/<token>`. Escaneado
con el celular abre la central de mando, desde donde:

- se ve si la tele está conectada,
- se toca **📺 Enviar a la tele** (la tele cambia sola en ≤5 segundos),
- están los pasos para instalar la carta en un Android TV,
- aparece el código corto para tipear en la tele.

El link corto se genera solo (lazy) la primera vez que se abre el panel, con
índice único en la DB. **Requiere la migración
`supabase/self-host/migrate-tv-remote.sql`** (sin ella no hay código corto ni
mando a distancia; la carta sigue funcionando normal).

---

## 2. Puesta en marcha (3 pasos)

1. **Creá la pantalla y tocá Publicar.** Sin publicar, la tele muestra la
   versión anterior (o nada si es la primera vez).
2. **Escaneá el QR con el celular** (o copiá el link). Desde el celular le
   mandás la carta a la tele.
3. **Abrí el link en la tele** y dejalo en pantalla completa. En menos de un
   minuto el panel marca la pantalla como **🟢 Conectada**.

---

## 3. Por dispositivo

### 3.1 Android TV (Chromecast con Google TV, Nvidia Shield, Smart TV con Android TV)

**Opción 1 — Chrome + "Instalar app" (la recomendada):**

1. Abrí **Chrome** en la tele y entrá al link (usá el código corto: escribí
   `portal659.com.ar/t/k7f2`).
2. Tocá el menú **⋮** → **Instalar app** (en algunos aparatos: "Agregar a
   pantalla de inicio").
3. Listo: queda un ícono en la tele que abre la carta **sola y a pantalla
   completa**. Si la tele se reinicia, un toque y vuelve.

> Cada pantalla tiene **su propio manifest** (`/pantalla/<token>/manifest.webmanifest`),
> con `display: fullscreen`, `orientation: landscape` y `start_url` apuntando a
> esa carta. Por eso el ícono abre la carta y no el home del portal.

**Opción 2 — Fully Kiosk Browser (ÚLTIMA opción):**

Para TVs sin Chrome, sin la opción de instalar, o si querés un kiosco 100%
bloqueado (sin barra, pantalla siempre encendida):

1. Instalá **Fully Kiosk Browser** (gratis, desde la Play Store del aparato).
2. `Settings → Start URL` → pegá el link (o el corto).
3. Activá **Kiosk mode** y **Keep screen on**.

**Además:** en *Ajustes → Pantalla* dejá el **protector de pantalla
desactivado**, así la tele no se duerme a mitad de la carta. (El reproductor
además pide **Screen Wake Lock** mientras está en vivo, si el navegador lo
soporta.)

### 3.2 Samsung (Tizen)

1. Abrí **Samsung Internet** en el TV.
2. Ingresá la URL `/pantalla/<token>`.
3. Menú (☰) → **Pantalla completa** (o "Modo cine").
4. Para que no se apague: Configuración → General → Administración de energía
   → **Apagado automático: desactivado** (o "Sin apagado").
5. (Opcional) Agregala a favoritos para reabrir rápido tras un reinicio.

Alternativa sin navegador: app **Web Browser** de Tizen (misma URL).

### 3.3 LG (webOS)

1. Instalá **Web Browser** desde LG Content Store (gratis).
2. Abrí la URL `/pantalla/<token>`.
3. Botón de menú → **Pantalla completa**.
4. Configuración → General → Modo de suspensión: desactivar el apagado
   automático.

### 3.4 Amazon Fire TV / Fire TV Stick

1. Instalá **Silk Browser** (navegador de Amazon) desde la tienda.
2. Abrí la URL. Silk entra en pantalla completa automáticamente al reproducir
   video; para forzarla: menú → "Pantalla completa".
3. Desactivá el protector de pantalla: Configuración → Pantalla y sonidos →
   Protector de pantalla → desactivar.

### 3.5 PC o Mac

Abrí el link en Chrome o Edge y presioná **F11**.

---

## 4. Mando a distancia (celular → tele)

1. Escanéá el QR del panel (apunta a `/tv/<token>`).
2. Tocá **📺 Enviar a la tele**.

Cómo funciona por dentro:

- el POST `/api/pantalla/<token>/remote` escribe `remote_command` +
  `remote_at` en **todas** las pantallas del comercio (la tele puede estar
  mostrando cualquiera de ellas);
- el **SSE** de cada pantalla (que ya consulta la DB cada 5s) empuja el
  comando;
- el reproductor navega a `/pantalla/<destino>`.

Tarda **≤5 segundos**. Si la tele está apagada o sin internet, el comando
queda esperando y se aplica cuando la tele vuelva a abrir el link.

El mismo botón existe **dentro del panel** ("📺 Enviar a la tele" en cada
pantalla): sirve, por ejemplo, cuando la tele quedó mostrando otra carta.

---

## 5. Recomendaciones generales

- **Resolución**: la carta está diseñada para 1920×1080 (1080p). En 4K se
  escala sin pérdida. En 720p se ve más chica pero legible.
- **Orientación**: horizontal (landscape). No soporta vertical.
- **Brillo/contraste**: subí el brillo al máximo en locales luminosos; la
  paleta "noche" del editor rinde mejor en ambientes oscuros.
- **Caché**: si la TV muestra una carta vieja tras publicar, forzá un
  refresco (F5) o reiniciá el navegador. El reproductor recarga cada 6 horas
  automáticamente y guarda el último snapshot en
  `localStorage["tv-snapshot:<token>"]`.
- **Actualizaciones**: la carta se actualiza sola cuando publicás cambios
  (SSE + polling de respaldo de 30s). Si se perdió internet, la tele sigue
  mostrando la última carta que tenía cargada.
- **Rotación de token**: si la URL se filtró, rotala desde el panel ("Rotar
  link"); la TV vieja deja de recibir actualizaciones. El **código corto no
  cambia** al rotar: sigue apuntando a la pantalla (redirige al token nuevo).

---

## 6. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| Pantalla negra | El token fue rotado o la pantalla borrada | Copiar la URL actual del panel |
| "Sin señal" en el panel | La tele no tiene la página abierta | Abrí el link en la tele y dejalo abierto |
| Carta vieja | Caché del navegador | F5 o reiniciar el navegador |
| "Este local todavía no cargó su carta" | Sin productos disponibles | Cargar productos en el panel |
| Se apaga sola | Protector de pantalla / suspensión | Desactivar en ajustes del TV |
| No se actualiza | SSE bloqueado por el navegador | El polling de 30s cubre el caso |
| El ícono abre el portal, no la carta | Se instaló el manifest del portal | Desinstalar el ícono y reinstalar desde `/pantalla/<token>` |
| El mando a distancia no hace nada | Falta la migración `migrate-tv-remote.sql` | Aplicar la migración en el contenedor |
| No aparece el QR de "Pedí online" | Interruptor apagado | Editor → *QR de pedidos online → ON* + el local tiene que vender online |

---

## 7. Posters (F3)

Los posters se intercalan entre las slides de la carta. Subilos desde el
editor (PNG/JPG o MP4). Cada poster se muestra a pantalla completa durante
los segundos configurados (imágenes) o se reproduce completo (videos, muted).

---

## 8. Qué es (y qué no es) la app del Play Store

La app de **Portal 659** del Play Store (TWA) es para **celular y tablet**:
panel, pedidos, mensajes y favoritos. **No sirve en Android TV** (no declara
`LEANBACK_LAUNCHER`) y hoy está en prueba cerrada: no hace falta para la
Pantalla TV.

En el televisor no se instala ninguna app del Play Store: se usa el navegador
(Chrome + "Instalar app" = PWA) y, como última opción, Fully Kiosk Browser.
