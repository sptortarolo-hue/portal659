# Pantalla TV — URL Launcher (Samsung Tizen, LG webOS, Fire TV, Android TV)

Guía para mostrar la carta del comercio en un televisor del local usando la
URL pública `/pantalla/[token]`. No requiere instalar ninguna app: el TV solo
necesita un navegador que pueda abrir una URL y mantenerla en pantalla
completa.

## 1. Obtener la URL de la pantalla

1. Entrá al panel del comercio → pestaña **Pantalla TV** (solo planes con la
   feature `screens`: gratuito = 1 pantalla, Gestión = 2).
2. Creá una pantalla (nombre + tipo "Carta"). Se genera un token único.
3. Publicá el borrador ("Publicar en la TV"). La URL queda:
   `https://www.portal659.com.ar/pantalla/<token>`
4. Copiá la URL (botón "Copiar link"). También podés rotar el token si la URL
   se filtró.

> La pantalla se actualiza sola cuando publicás cambios (SSE + polling de 30s).
> Si el TV pierde internet, muestra la última carta cacheada en `localStorage`.

## 2. Samsung (Tizen) — Samsung Internet

1. Abrí **Samsung Internet** en el TV.
2. Ingresá la URL `/pantalla/<token>`.
3. Menú (☰) → **Pantalla completa** (o "Modo cine").
4. Para que no se apague: Configuración → General → Administración de energía
   → **Apagado automático: desactivado** (o "Sin apagado").
5. (Opcional) Agregala a favoritos para reabrir rápido tras un reinicio.

Alternativa sin navegador: app **Web Browser** de Tizen (misma URL).

## 3. LG (webOS) — LG Content Store

1. Instalá **Web Browser** desde LG Content Store (gratis).
2. Abrí la URL `/pantalla/<token>`.
3. Botón de menú → **Pantalla completa**.
4. Configuración → General → Modo de suspensión: desactivar el apagado
   automático.

## 4. Amazon Fire TV / Fire TV Stick

1. Instalá **Silk Browser** (navegador de Amazon) desde la tienda.
2. Abrí la URL. Silk entra en pantalla completa automáticamente al reproducir
   video; para forzarla: menú → "Pantalla completa".
3. Desactivá el protector de pantalla: Configuración → Pantalla y sonidos →
   Protector de pantalla → desactivar.

## 5. Android TV genérico (Chromecast con Google TV, Nvidia Shield, etc.)

1. Instalá **Chrome** o **Fully Kiosk Browser** (recomendado para kioscos).
2. Con Fully Kiosk: Settings → Start URL = `/pantalla/<token>`; activá
   "Kiosk mode" y "Keep screen on".
3. Con Chrome: abrí la URL y usá "Agregar a pantalla de inicio" para un
   acceso directo.

## 6. Recomendaciones generales

- **Resolución**: la carta está diseñada para 1920×1080 (1080p). En 4K se
  escala sin pérdida. En 720p se ve más chica pero legible.
- **Orientación**: horizontal (landscape). No soporta vertical.
- **Brillo/contraste**: subí el brillo al máximo en locales luminosos; la
  paleta "noche" del editor rinde mejor en ambientes oscuros.
- **Caché**: si la TV muestra una carta vieja tras publicar, forzá un
  refresco (F5) o reiniciá el navegador. El reproductor recarga cada 6 horas
  automáticamente.
- **Rotación de token**: si la URL se filtró, rotala desde el panel; la TV
  vieja deja de recibir actualizaciones.

## 7. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| Pantalla negra | El token fue rotado o la pantalla borrada | Copiar la URL actual del panel |
| Carta vieja | Caché del navegador | F5 o reiniciar el navegador |
| "Este local todavía no cargó su carta" | Sin productos disponibles | Cargar productos en el panel |
| Se apaga sola | Protector de pantalla / suspensión | Desactivar en ajustes del TV |
| No se actualiza | SSE bloqueado por el navegador | El polling de 30s cubre el caso |

## 8. Posters (F3)

Los posters se intercalan entre las slides de la carta. Subilos desde el
editor (PNG/JPG o MP4). Cada poster se muestra a pantalla completa durante
los segundos configurados (imágenes) o se reproduce completo (videos, muted).