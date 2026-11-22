# Precios, costos y ganancia — el modelo unificado

> Plan "costo → ganancia → precio" (nov-2026). Resuelve la inconsistencia histórica:
> tres definiciones de ganancia, dos fuentes de costo y redondeos dispersos.

## Reglas del sistema

| Regla | Decisión |
|---|---|
| Fuente de costo para pricing | **`cost_last` estricto** (el último costo de compra), en TODOS los circuitos |
| Lenguaje de ganancia | **Recargo % sobre costo** ("le pongo el 50%"), siempre mostrando la pareja equivalente |
| Redondeo | Configurable por lista de margen y global del comercio; default neutro |
| Margen visible | % de margen junto al precio/costo en catálogo, listas y recetario |
| Margen real contable | Snapshot de costo en la venta → Fase D (pendiente) |

## El vocabulario de la ganancia (Fase B)

Tres formas de decir lo mismo — **recargo ↔ margen ↔ food cost**:

```
recargo 50%   = margen 33,3% = food cost 66,7% → costo $1.000 → $1.500
recargo 100%  = margen 50%   = food cost 50%   → costo $1.000 → $2.000
```

- **Recargo** (markup): % sobre el costo. `precio = costo × (1 + x/100)`. *Es el término primario del panel.*
- **Margen**: % sobre el precio. `precio = costo / (1 − mg/100)`.
- **Food cost**: % del precio que se come el costo = `100 − margen`. (el idioma del recetario).

Helpers client-safe en `src/lib/price-rounding.ts`: `equivalentsFromMarkup`, `equivalentsFromMargin`,
`equivalentsFromFoodCost`, `gainFromPriceCost(price, cost)`. Línea de equivalencia lista:
`gainEquivalenceLine(rule, pct, rounding)` en `src/components/dashboard/margin-lists-manager.tsx`.

**Dónde se muestra la pareja:** alta/edición de listas de margen, modal de precios masivos
(MenuStudio y ProductManager), form de producto (chip de ganancia junto al costo) y recetario
("Equivale a margen X% · recargo Y%").

## Dónde vive cada cosa

| Concepto | Campo | Dónde se configura |
|---|---|---|
| Costo de referencia | `products.cost_last` (y `product_variants.cost_last`) | Editor de producto, compras (lo pisa), import Excel, envasado |
| Costo para valorizar inventario | `products.cost_avg` (PMP) | Solo compras/envasado lo escriben; **nunca pricing** |
| Ganancia de una lista | `margin_lists.rule/pct` | Catálogo → Listas |
| Redondeo de una lista | `margin_lists.price_round_step/mode/tail` | Catálogo → Listas (alta/edición) |
| Redondeo global del comercio | `vendors.price_round_step/mode/tail` | Catálogo → Listas → card "🎯 Redondeo de precios del comercio" |
| Umbrales del semáforo food-cost | `vendors.food_cost_warn/bad` | Ya existía (Config → Preparación) |

## El motor de redondeo (Fase A)

`src/lib/price-rounding.ts` (client-safe, sin imports):

```ts
// Un precio válido toma la forma k·step + tail:
applyRounding(1340, { step: 100, mode: "nearest", tail: 0 })   // → 1300
applyRounding(1350, { step: 100, mode: "nearest", tail: 0 })   // → 1400 (empate → arriba)
applyRounding(1234, { step: 100, mode: "up",       tail: 99 }) // → 1299
applyRounding(1234, { step: 100, mode: "nearest",  tail: 99 }) // → 1199
applyRounding(1234, { step: 1,   mode: "nearest",  tail: 0.99 }) // → 1233,99
```

- **Direcciones** (como VTEX/Dux/RMH POS): `nearest` (mitad abajo/mitad arriba, empate → arriba),
  `up` (blinda margen, infla ~medio múltiplo), `down`.
- **Default neutro** `{step:1, nearest, tail:0}` === el `Math.round` histórico:
  sin configurar nada, ningún precio cambia.
- La regla solo toca **precios calculados**: lista de margen, precios masivos, sugerido del
  recetario. Nunca promos a mano, ni descuentos (volumen/efectivo), ni el total del carrito.
- `priceFromCost(cost, rule, pct, rounding?)` en `src/lib/cost-reprice.ts` es la **única**
  fórmula precio-desde-costo del sistema. `promoFromRatio` hereda el redondeo.

## Fase C — cost_last estricto

- Repuestos del taller (`POST /api/vendor/bookings/[id]/parts` y `import-quote`):
  costo = `cost_last` solamente. Sin costo → fila en 0, evento "⚠️ sin costo" en el timeline
  de la orden y flag `costMissing` en la respuesta (el margen queda incompleto, nunca finge).
- Reposición: ya estimaba con `costLast` (el `costAvg` que devuelve es informativo).
- `supplier_pricelists`: congelado — es dato de proveedor (se alimenta desde compras),
  **no** alimenta costos ni precios. Revisión futura si se quiere "aplicar como costo".

## Fase D — margen real en analytics (implementada nov-2026)

**Snapshot de costo en la venta**: cada ítem de `orders.items[]` guarda `cost` (costo unitario
al vender, mismo patrón que `work_order_parts`). Fuentes:

- `resolveOrderPricing` (`src/lib/pricing.ts`) → cubre **app orders, Mostrador y Mesas**
  (`pos/order`, `pos/consumicion` usan `pricing.items`). Tolerante a migrate-inventory.sql
  sin aplicar (ítems sin `cost`).
- Webhook MP → enriquece los ítems desde `metadata.stock_items` (product_id/variant_id por
  índice) consultando `cost_last`. Best-effort: sin costo, margen parcial.

Con packs: `cost` es por unidad (línea = cost × qty); envasado online: por paquete
(el `cost_last` del terminado es costo del lote/paquete).

**Reporte**: `GET /api/vendor/analytics` devuelve `realMargin` — ganancia real del período =
plata neta de productos (itemRevenue menos descuentos prorrateados, sin envío) − Σ(cost × qty).
`coverage` = % de la plata con costo conocido: si no llega al 99% la UI avisa "margen parcial"
(pedidos viejos y mesas sin snapshot). Card "💰 Ganancia real del período" en el tab Analytics.
Excluye líneas manuales ("Varios") y servicios (turnos no traen costo).

## Verificación

```
node scripts/check-price-rounding.mjs   # motor + fórmula única + equivalencias
npx tsc --noEmit
```

## Migración (aplicar en el VPS)

```
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-price-rounding.sql
```

Sin la migración todo funciona con el default neutro; las APIs y la UI son tolerantes
(detectan las columnas por `information_schema`).

## Fase D — margen real (hecha, nov-2026)

Snapshot de costo en `orders.items[]` al vender (createOrder / POS / mesas vía
`resolveOrderPricing` + webhook MP vía `metadata.stock_items`) + reporte "Ganancia real
del período" en analytics (`realMargin`, con `coverage` para detectar margen parcial).

Margen real en analytics: snapshot de costo en `orders.items[]` al vender
(mismo patrón que `work_order_parts`) + reporte "ganancia del mes" real.
Hoy la única ganancia visible es estimada (precio actual vs costo actual) y el margen
de órdenes de taller (snapshot de repuestos).
