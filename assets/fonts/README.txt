Fuentes: Roboto Bold y Roboto Regular (AAQ_FOT) — license Apache License 2.0.

Roboto Bold
Autor: Google (impresión). Fuente descargada del paquete
npm @expo-google-fonts/roboto (Roboto_700Bold.ttf).

Roboto Regular
Autor: Google (comprobantes PNG para WhatsApp / documentos del panel).
Mismo paquete npm @expo-google-fonts/roboto (Roboto_400Regular.ttf).

Licencia: Apache License 2.0
https://www.apache.org/licenses/LICENSE-2.0

Se usan en runtime por:
- src/lib/thermal-printer.ts → encabezado del ticket térmico (vía pureimage,
  FONT_PATH del módulo de impresión).
- src/lib/printer-image.ts → maquinaria compartida: registra ambas fuentes.
- src/lib/receipt-image.ts → comprobante "realzado" en PNG (documento vertical
  a color que se comparte por WhatsApp).

Son archivos de solo lectura usados en runtime. No cambiar nombre/ubicación
sin actualizar también las rutas (FONT_PATH / FONT_REGULAR_PATH) y el
Dockerfile (COPY --from=builder /app/assets ./assets).
