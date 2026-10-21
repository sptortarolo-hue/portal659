# QA — Portal 659 Envíos (envíos extendidos)

Zonas fuera del radio barrial, operadas por logísticas partner. **El portal es la plataforma** (sin APIs externas; los operadores usan un panel interno). El cliente paga el envío al comercio (transferencia o MP — **no hay contrareembolso en v1**).

## Migración (aplicar 1 vez antes de usar)

```bash
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-portal-shipments.sql
```

Todo el resto es tolerante a migración sin aplicar: sin `shipping_zones` el checkout no muestra la opción, `fetchVendorShipZones` devuelve `[]` y los endpoints devuelven `[]` / 503 con mensaje claro.

## Fase A — datos, checkout y cobro

- Migración: `carriers`, `shipping_zones` (catálogo del portal), `vendor_ship_zones` (opt-in), `shipments`, `shipment_events`, `carrier_operators`; `orders.shipping_zone_id` + `shipping_zone_name`.
- Config del comercio (comercio y moda): Config → 🚚 Envíos lejanos (Portal 659) — activa zonas del catálogo y fija precio (override nunca por debajo del catálogo).
- Checkout: si el comercio tiene zonas activas aparece "¿Vivís fuera del barrio?" (select). Precio plano del catálogo, **sin gratis-desde** (`free_delivery_min` no aplica).
- `createOrder` y webhook MP guardan `shipping_zone_id/name` (el fee viaja en `orders.delivery_fee`); transferencia y MP por igual.
- Pedidos que caen fuera de zona si el opt-in se apagó no se rechazan: quedan fuera-de-zona típica (coordina por WhatsApp).

### QA
1. Config: activar/desactivar zona, probar override < catálogo (debe rechazarse con mensaje).
2. Checkout: pedir con zona extendida; el resumen muestra la zona y el fee; sin zona activa el select no aparece.
3. Pedido con transferencia y con MP: ambos guardan zona.
4. Pedidos viejos (sin zona) siguen funcionando igual (sin tarjeta 🚚).

## Fase B — oblea, tracking y ciclo

- Panel del comercio: detalle del pedido (delivery zonificado) muestra tarjeta "🚚 Envío extendido" (reemplaza al repartidor propio). Botón "🚚 Avisar a la logística" crea el envío → código `ENV-XXXXXX` (único; re-invocar devuelve el existente, no duplica).
- Oblea A4: `/vendor/shipment/[id]` (Imprimir) con QR al tracking. Oblea térmica contingencia: `POST /api/print {type:"shipment_label", shipmentId, copies}` (sin gate de plan; 80/58 mm, copia logística opcional).
- Tracking público: `/envio/[code]` (noindex vía layout) con timeline. Snapshot cada 20s hasta estado terminal.
- APIs: `GET/POST /api/vendor/shipments`, `GET/DELETE /api/vendor/shipments/[id]` (cancelación solo antes de colectado), `GET /api/shipments/track/[code]` (público rate-limited, sin PII del comprador).

### QA
1. Crear envío desde el detalle → aparece código + botones Oblea / Ver tracking.
2. Oblea A4 imprime QR, destino, contenido; térmica de prueba con copias=2.
3. `/envio/[code]` público con celular sin cuenta; code malo → 404 amable.
4. DELETE de envío ya colectado → 409 con mensaje de coordinar con operador.

## Fase C — operador y sync de pedidos

- `/envios` (login normal; alta en `/admin/logisticas` → Operadores): encargos del carrier, flujos `requested → picked_up → in_transit → delivered/failed_attempt/returned`, nota + foto POD (`POST /api/shipment-upload`, carpeta `shipments/`).
- Mapeo a pedidos (`orderStatusForShipmentEvent` + `syncOrderForShipmentStatus`): picked_up/in_transit → `sent`; delivered → `completed` (+closed_at); returned → `cancelled`. failed_attempt NO toca el pedido. Estados terminales del pedido no se re-abren.
- Push best-effort al comercio en cada mapeo. Timeline pública vía `shipment_events`.

### QA
1. Alta de operador con usuario existente; login → `/envios` lista sus encargos (asignados o sin carrier con zona sin logística).
2. Transiciones válidas/inválidas (409 fuera del orden permitido).
3. Colectado → pedido pasa a `sent`; entregado → `completed`; devuelto → `cancelled`. El Kanban del comercio refleja los cambios.
4. Foto POD aparece en el tracking público (solo imagen, sin datos personales).
5. Sin la tabla de envíos el panel del operador dice que falta migración.

## Fase D — admin

- `/admin/logisticas` (link en sidebar/bottom-nav): ABM de carriers, catálogo de zonas (precio/ETA/logística/orden/activa) y alta de operadores por email (el usuario ya debe existir; validación en la API).
- APIs: `GET/POST/PATCH /api/admin/carriers`, `GET/POST/PATCH /api/admin/ship-zones` (con `kind: "zone" | "operator"`).

### QA
1. Alta de carrier/zona/operador; edición inline con blur; active off oculta la zona del catálogo.
2. Zona sin logística: el shipment nace `carrier_id NULL` y la ve cualquier operador activo (asignación manual).

## Pendientes de próxima iteración

- Detalle histórico/liquidación XLSX por carrier (settlement) y analytics de envíos.
- Notificación al comprador por email/WA al cambiar de estado (hoy: solo tracking).
- Cancelación por devolución con motivo del comercio (hoy: motivo genérico).
- Reparto de ganancia del envío (portal ↔ comercio si el override suma) — contable.
