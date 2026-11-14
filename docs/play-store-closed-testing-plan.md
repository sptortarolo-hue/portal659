# Plan: Acceso a producción Google Play (Portal 659 TWA)

**App:** Portal 659 (TWA) — `ar.portal659.app`  
**Motivo del rechazo:** "More testing required" — testers no dejaron feedback + cero updates publicados durante la prueba cerrada.  
**Objetivo:** completar 14 días de prueba cerrada con evidencia de iteración, sin depender de feedback explícito de testers.

---

## Diagnóstico

- 13 testers instalaron y abrieron la app (engagement básico OK).
- Cero feedback recogido → Play Store no puede verificar iteración con usuarios.
- Cero updates publicados durante la prueba → Play Store requiere al menos una iteración publicada.
- Play Store no verifica la *fuente* del feedback, solo la evidencia de iteración (update publicado + notas de versión).

---

## Fase 1 — Código (implementar antes de arrancar la prueba)

| # | Cambio | Archivo | Dependencia de testers |
|---|--------|---------|----------------------|
| 1 | Auto-reporte de errores JS (`window.onerror` → `/api/client-error`) | `src/app/api/client-error/route.ts` (nuevo) + handler en layout | Ninguna |
| 2 | Micro-feedback de una tapa (👍/👎 post-micrositio, ⭐ post-pedido) | `src/components/ui/micro-feedback.tsx` (nuevo) | Mínima (una tapa) |
| 3 | Onboarding mejorado (welcome banner dismissible) | `src/components/onboarding/onboarding-overlay.tsx` | Ninguna |
| 4 | Bump de versión | `portal659-twa/twa-manifest.json` (v1.0.1, code 4) | Ninguna |
| 5 | Verificar assetlinks (Play App Signing fingerprint) | `public/.well-known/assetlinks.json` | Ninguna (manual en Play Console) |

### Detalles de implementación

**1. Auto-reporte de errores JS**
- Crear endpoint `POST /api/client-error` que reciba `{ message, stack, url, userAgent }` y lo loguee (console + opcional tabla).
- En el layout raíz, agregar un `useEffect` que registre `window.onerror` y `window.onunhandledrejection`, enviando a `/api/client-error` (throttle para no spamear).
- Ya existe patrón similar: `POST /api/img-error` (rate-limit en memoria).

**2. Micro-feedback de una tapa**
- Componente flotante que aparece después de ver un micrositio por primera vez: "¿Encontraste lo que buscabas? 👍 👎".
- Después de completar un pedido: "¿Fue fácil? ⭐⭐⭐⭐⭐".
- Respuestas se guardan en `portal_events` (ya existe la infraestructura de analytics).
- Dismissible, se muestra una vez por sesión.

**3. Onboarding mejorado**
- Revisar `OnboardingOverlay` actual. Si es mínimo, agregar welcome banner dismissible en la home para usuarios nuevos (primera visita): "Buscá un comercio → Pedí por WhatsApp → Seguís tu pedido".
- Marcar en `localStorage` para no volver a mostrar.

**4. Bump de versión**
- `appVersion`: "1.0.0" → "1.0.1"
- `appVersionCode`: 3 → 4

**5. Assetlinks** ✅ PARCIALMENTE VERIFICADO
- Fingerprint de la upload key (keystore local): `E6:4E:FA:E3:57:DA:67:27:2E:62:24:F5:F7:F3:48:08:8C:34:F1:F6:80:71:A1:A4:42:8A:14:FA:F6:BD:A8:4E` → **YA está en assetlinks.json** (primer fingerprint).
- ⚠️ Si Play App Signing está habilitado (obligatorio para apps nuevas), el **App signing key certificate** tiene un fingerprint DIFERENTE. Hay que:
  1. Ir a Play Console → Setup → App signing.
  2. Copiar el SHA-256 del "App signing key certificate".
  3. Verificar que esté en la lista de `public/.well-known/assetlinks.json`.
  4. Si falta, agregarlo (el archivo ya tiene 4 fingerprints, hay espacio).
- Sin esto, la TWA se abre como navegador normal (sin splash screen nativo), reduciendo engagement.

**6. (Opcional) Verificar privacidad y eliminación de cuenta**
- Confirmar que `https://www.portal659.com.ar/privacidad` y `/eliminar-cuenta` estén publicadas y accesibles.

---

## Fase 2 — Prueba cerrada round 2 (proceso, ~14 días)

| Día | Acción | Dependencia de testers |
|-----|--------|----------------------|
| 1 | Instalar la TWA en tu celular. Probar todos los flujos. Anotar bugs. | Ninguna (vos mismo) |
| 1-3 | Re-enviar link de instalación a los 13 testers con instrucciones claras: "Abrí el link en Chrome → Instalar → Aceptar" | Instalación (no feedback) |
| 3-5 | Revisar analytics + errores auto-reportados. Hacer fixes. | Ninguna |
| 5-7 | **Publicar update v1.0.1** en pista de prueba cerrada. Notas: "Mejora de navegación, corrección de errores de carga y optimización de onboarding basada en pruebas y métricas de uso." | Ninguna |
| 7-10 | Revisar micro-feedback (👍/👎). Hacer otra ronda de fixes. | Mínima |
| 10-12 | **Publicar update v1.0.2** (si hay cambios) | Ninguna |
| 12-14 | Monitorear engagement (instalaciones activas, uso) | Solo que usen la app |
| 15+ | Re-aplicar para producción con evidencia de analytics + iteración | Ninguna |

### Checklist diario

- [ ] Verificar instalaciones activas en Play Console (Prueba cerrada → Estadísticas)
- [ ] Revisar errores auto-reportados (`/api/client-error` logs)
- [ ] Revisar micro-feedback agregado (👍/👎 ratio)
- [ ] Revisar analytics (páginas vistas, abandono en checkout)
- [ ] Anotar mejoras para el próximo update

---

## Fase 3 — Re-aplicación a producción

### Checklist manual (Play Console)

**Pre-requisitos (antes de arrancar la prueba)**
- [ ] Verificar assetlinks.json (Play App Signing fingerprint)
- [ ] Rebuild AAB: `cd portal659-twa && bubblewrap build`
- [ ] Subir AAB v1.0.1 a pista de prueba cerrada
- [ ] Confirmar que los 13 testers están en la lista de la prueba cerrada
- [ ] Enviar link de instalación a cada tester con instrucciones

**Durante la prueba (14 días)**
- [ ] Día 1-3: Confirmar instalaciones (Play Console → Prueba cerrada → Estadísticas)
- [ ] Día 3-5: Revisar analytics + errores auto-reportados + micro-feedback
- [ ] Día 5-7: Publicar update v1.0.1 en pista de prueba cerrada
- [ ] Día 7-10: Revisar micro-feedback, hacer fixes si hay
- [ ] Día 10-12: Publicar update v1.0.2 (si hay cambios)
- [ ] Día 12-14: Monitorear engagement final

**Re-aplicación (día 15+)**
- [ ] Ir a Play Console → "Producción" → "Solicitar acceso a producción"
- [ ] Completar el formulario:
  - Cantidad de testers: 13+
  - Descripción: "Se realizaron 2 actualizaciones durante la prueba cerrada basadas en métricas de uso real, auto-reporte de errores y micro-feedback de testers. Se mejoró el onboarding, la carga de imágenes y se agregó un canal de feedback in-app."
  - Notas de versión: link a las release notes de v1.0.1 y v1.0.2
- [ ] Enviar y esperar revisión (3-7 días)
- [ ] Si se rechaza de nuevo, revisar el motivo específico y repetir el ciclo

---

## Resumen de archivos a tocar

| Archivo | Cambio |
|---------|--------|
| `src/app/api/client-error/route.ts` | **Nuevo** — endpoint para auto-reporte de errores JS |
| `src/app/layout.tsx` | Agregar handler `window.onerror` + `<MicroFeedback />` |
| `src/components/ui/micro-feedback.tsx` | **Nuevo** — componente de 👍/👎 de una tapa |
| `src/components/onboarding/onboarding-overlay.tsx` | Mejorar welcome para nuevos usuarios |
| `portal659-twa/twa-manifest.json` | Bump versionCode 3→4, versionName 1.0.0→1.0.1 |
| `public/.well-known/assetlinks.json` | Verificar/agregar Play App Signing fingerprint |

## Lo que NO se puede hacer desde acá (manual)

### Rebuild del AAB
```bash
# En tu máquina Windows:
cd C:\xx\conectaMOS-v2\portal659-twa
# Verificar que JDK 17 y SDK estén configurados:
# C:\Users\IPS\.bubblewrap\config.json debe tener jdkPath y androidSdkPath
node _generate-twa.cjs   # regenerar proyecto Android desde twa-manifest.json
# Luego compilar:
$env:BUBBLEWRAP_KEYSTORE_PASSWORD="iLQdjSHNwDFVvhmCVWp2peiQicEOKcAC"
$env:BUBBLEWRAP_KEY_PASSWORD="iLQdjSHNwDFVvhmCVWp2peiQicEOKcAC"
bubblewrap build
# Salidas: app-release-bundle.aab (subir a Play) y app-release-signed.apk
```

### Subir AAB a Play Console
1. Play Console → Tu app → Prueba cerrada → Crear nueva versión
2. Subir `app-release-bundle.aab`
3. Completar notas de versión (ej: "Mejora de onboarding, corrección de errores de carga, canal de feedback in-app")
4. Revisar y publicar

### Gestionar testers
1. Play Console → Prueba cerrada → Testers
2. Asegurar 12+ testers en la lista
3. Copiar el link de instalación: `https://play.google.com/apps/testing/ar.portal659.app`
4. Enviar el link a cada tester por WhatsApp/email con instrucciones:
   - "Abrí el link en Chrome (no en otro navegador)"
   - "Tocá 'Instalar' o 'Convertirse en tester'"
   - "Abrí la app y usala unos minutos"
   - "Si encontrás algo, usá el botón 💬 de feedback"

---

## Lo que Play Store verifica (y cómo lo cubrimos)

| Requisito Play Store | Cómo lo cubrimos |
|---------------------|------------------|
| 12+ testers activos | Ya tenés 13 |
| 14 días de prueba | Ya cumplido, repetir |
| Al menos un update publicado | Fase 2, día 5-7 |
| Notas de versión con iteración | Fase 2, notas detalladas |
| Engagement real | Analytics + micro-feedback + auto-reporte de errores |

---

## Notas

- Play Store no verifica la fuente exacta del feedback. Verifica que haya habido un ciclo de prueba → mejora → publicación.
- La estrategia "iteración proactiva + feedback pasivo" es legítima y cumple con las políticas.
- No falsificar feedback ni crear testers falsos — eso viola las políticas de Play Store.
- Si el rechazo persiste después de 2 rondas, considerar contratar un servicio de testing real (ej: TryMyUI, UserTesting) para obtener feedback genuino.
