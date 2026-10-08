# Plan de Publicación en Google Play Store

**Fecha:** Octubre 2026  
**Cuenta:** Personal (requiere prueba cerrada antes de producción)

---

## Estado Actual

### Portal 659 (app de clientes)

| Item | Estado |
|---|---|
| AAB firmado | ✅ `portal659-twa/app-release-bundle.aab` |
| APK firmado | ✅ `portal659-twa/app-release-signed.apk` |
| assetlinks.json | ✅ Publicado y verificado |
| Política de privacidad | ✅ `https://www.portal659.com.ar/privacidad` |
| Feature graphic | ✅ `public/feature-graphic.jpg` (1024×500) |
| Screenshots | ✅ 12 capturas en `public/playstore-screenshots/` |
| Ícono | ✅ `public/icons/icon-512.png` |
| Keystore | ✅ `C:\Users\IPS\portal659-keystore\portal659-release.keystore` |

### Portal Print (app de impresión)

| Item | Estado |
|---|---|
| AAB firmado | ✅ `android/android/app/build/outputs/bundle/release/app-release.aab` (versionCode 2) |
| FGS specialUse | ✅ Corregido (sin tope de 6h) |
| Política de privacidad | ✅ `https://www.portal659.com.ar/privacidad-print` |
| Video FGS | ✅ Grabado (subir a YouTube como "No listado") |
| Keystore | ✅ `C:\Users\IPS\portal659-keystore\portal-print-release.keystore` |

---

## Tabla de Tiempos

| App | Camino | Tiempo estimado |
|---|---|---|
| Portal 659 | Prueba cerrada (14 días) + Producción (3-7 días) | **17-21 días** |
| Portal Print | Ya en prueba cerrada + Producción (3-7 días) | **17-21 días** |

---

## Portal 659 — Pasos Detallados

### Paso 1: Crear app en Play Console

1. Entrar a https://play.google.com/console
2. Click en **"Crear app"**
3. Completar:
   - **Nombre de la app:** Portal 659
   - **Idioma predeterminado:** Español (Latinoamérica), es-419
   - **App o juego:** Aplicación
   - **Gratuita o pagada:** Gratis
4. Aceptar declaraciones (políticas + leyes de exportación)
5. Click en **"Crear app"**

### Paso 2: Firma de la app

1. Menú lateral → **Configuración → Firma de la app**
2. Habilitar **"Firma de apps de Google Play"**
3. **Copiar el SHA-256 del "Certificado de firma de app"**
4. Guardar este valor (se usa en el Paso 3)

### Paso 3: Actualizar assetlinks.json

**En la máquina local:**

1. Editar `public/.well-known/assetlinks.json`
2. Reemplazar el fingerprint actual con el SHA-256 del Paso 2
3. Commit + push a master
4. Esperar deploy (~20 minutos)
5. Verificar en https://developers.google.com/digital-asset-links/tools → debe decir "verified"

### Paso 4: Crear versión en Prueba cerrada

1. Menú lateral → **Pruebas → Prueba cerrada**
2. Click en **"Crear versión"**
3. Subir archivo: `portal659-twa/app-release-bundle.aab`
4. **Nombre de la versión:** `1.0.0`
5. **Notas de la versión:**
   ```
   Primera versión de Portal 659 para Android.
   ```
6. Click en **"Guardar"**

### Paso 5: Cargar verificadores

1. Menú lateral → **Pruebas → Prueba cerrada → Verificadores**
2. Click en **"Agregar verificadores"**
3. Escribir 12 emails (separados por coma)
4. Click en **"Enviar invitaciones"**
5. Los verificadores reciben un email para aceptar participar

**Lista de 12 emails (sugerida):**
```
comercio1@gmail.com
comercio2@gmail.com
comercio3@gmail.com
comercio4@gmail.com
comercio5@gmail.com
comercio6@gmail.com
comercio7@gmail.com
comercio8@gmail.com
comercio9@gmail.com
comercio10@gmail.com
comercio11@gmail.com
comercio12@gmail.com
```

### Paso 6: Completar ficha de Play Store

1. Menú lateral → **Presencia en la tienda → Ficha principal de Play Store**
2. Completar campos:

**Nombre de la app:** Portal 659

**Descripción corta (80 caracteres):**
```
El centro comercial de tu barrio. Comprá a los comercios de Sicardi y Garibaldi.
```

**Descripción completa:**
```
Portal 659 es el centro comercial de tu barrio. Encontrá comida, comercios y servicios de Sicardi y Garibaldi en un solo lugar.

• Pedidos directos a los comercios, sin comisiones
• Contacto directo por WhatsApp
• Información del barrio: transporte, horarios, noticias
• Reseñas de otros vecinos

Descubrí lo que tu barrio tiene para ofrecerte.
```

**Categoría:** Shopping

**Ícono de la app:** `public/icons/icon-512.png`

**Gráfico de funciones:** `public/feature-graphic.jpg`

**Capturas de pantalla de teléfono:** Subir al menos 2 de:
- `public/playstore-screenshots/home-phone.png`
- `public/playstore-screenshots/buscar-phone.png`
- `public/playstore-screenshots/micrositio-phone.png`
- `public/playstore-screenshots/barrio-phone.png`
- `public/playstore-screenshots/planes-phone.png`
- `public/playstore-screenshots/login-phone.png`

**Capturas de pantalla de tablet:** Subir al menos 2 de:
- `public/playstore-screenshots/home-tablet.png`
- `public/playstore-screenshots/buscar-tablet.png`
- `public/playstore-screenshots/micrositio-tablet.png`

**Política de privacidad:** `https://www.portal659.com.ar/privacidad`

**Correo electrónico de contacto:** (tu email)

**Sitio web:** `https://www.portal659.com.ar`

### Paso 7: Seguridad de los datos

1. Menú lateral → **Contenido de la app → Seguridad de los datos**
2. Completar cuestionario:

**¿Tu app recopila o comparte alguno de los tipos de datos que se requieren de los usuarios?** Sí

**Tipos de datos recolectados:**
- Información personal: nombre, email, teléfono/WhatsApp, barrio
- Actividad de la app: pedidos, favoritos, reseñas

**¿Se comparten datos con terceros?** Sí, con los comercios para procesar pedidos

**¿Se venden datos?** No

**¿Encriptados en tránsito?** Sí

**¿Eliminación a pedido?** Sí

### Paso 8: Clasificación de contenido

1. Menú lateral → **Contenido de la app → Clasificación de contenido**
2. Completar cuestionario IARC
3. Resultado esperado: **Apta para todos**

### Paso 9: Esperar 14 días

- Los 12 verificadores deben permanecer activos durante 14 días
- No se puede acelerar este paso

### Paso 10: Solicitar acceso a producción

1. Después de los 14 días, click en **"Solicitar acceso a producción"**
2. Responder preguntas sobre la prueba cerrada
3. Esperar aprobación de Google

### Paso 11: Review de producción

- 3-7 días
- Google revisa la app y la aprueba o rechaza

---

## Portal Print — Pasos Detallados

### Estado actual

- App creada en Play Console ✅
- AAB subido a Prueba cerrada ✅
- Versión en revisión ⏳

### Pasos restantes

1. **Esperar a que la versión de prueba cerrada sea aprobada** (1-3 días)
2. **Cargar 12 verificadores** en Prueba cerrada
3. **Completar ficha de Play Store:**
   - Nombre: Portal Print
   - Descripción corta: `Impresión automática de pedidos para comercios de Portal 659`
   - Descripción completa:
     ```
     Portal Print mantiene la conexión con el relay de impresión de Portal 659 para imprimir automáticamente los pedidos de tu comercio.

     Requisitos:
     • Celular en el mismo Wi-Fi que la impresora
     • Token de la sección Impresora del dashboard de tu comercio
     • Impresora térmica ESC/POS de red (puerto 9100)
     ```
   - Categoría: Business
   - Ícono: el que ya está en el AAB
   - Política de privacidad: `https://www.portal659.com.ar/privacidad-print`
4. **Seguridad de los datos:** No se recolectan datos
5. **Clasificación de contenido:** cuestionario IARC → apta para todos
6. **Declaración FGS:**
   - Tipo: specialUse
   - Justificación: `Mantiene la conexión activa con el relay de impresión de pedidos del comercio`
   - Video: link de YouTube del video grabado
7. **Esperar 14 días** con los 12 verificadores
8. **Solicitar acceso a producción**
9. **Review de producción:** 3-7 días

---

## Checklist Final

### Antes de enviar a revisión

- [ ] Ficha de Play Store completa (nombre, descripción, ícono, screenshots, categoría)
- [ ] Política de privacidad accesible y verificada
- [ ] Seguridad de los datos completada
- [ ] Clasificación de contenido completada
- [ ] Declaración FGS completada (solo Portal Print)
- [ ] AAB subido a Prueba cerrada
- [ ] 12 verificadores cargados y aceptados
- [ ] 14 días de prueba cerrada completados

### Después de la prueba cerrada

- [ ] Solicitar acceso a producción
- [ ] Responder preguntas sobre la prueba cerrada
- [ ] Esperar review de producción (3-7 días)

---

## Notas Importantes

1. **No se puede saltar la prueba cerrada** con cuenta personal
2. **Los 12 verificadores deben ser reales** (no emails falsos)
3. **El video de FGS debe mostrar la app funcionando** (no solo capturas)
4. **La política de privacidad debe ser específica para cada app**
5. **El assetlinks.json debe actualizarse con el SHA-256 de Play App Signing** (no el del keystore local)

---

## Contacto

- **Portal 659:** https://www.portal659.com.ar
- **Soporte:** (tu email de contacto)
