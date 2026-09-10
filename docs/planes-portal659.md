# Portal 659 — Planes y monetización (Sprint 8)

## Modelo de planes

El comercio **no paga por el software**, paga por **ordenarse y vender**. La escalera de
planes acompaña el crecimiento: el gratuito es el gancho (carta + carrito con tope), y
se paga cuando el negocio pide más.

| Plan | Precio | Productos | Pedidos/mes (app) | Features clave |
|---|---|---|---|---|
| **Gratuito** | $0 | Carta completa (ilimitado) | **20** (configurable) | micrositio + QR + carrito + checkout por WhatsApp |
| **Pedidos** | $4.990 | ilimitado | ilimitado | + analytics 7 días + gestión de reseñas |
| **Gestión integral** | $12.990 | ilimitado | ilimitado | + POS (Mostrador) + Mesas + Comanda (KDS) + impresión + cobro online + **Recetas/escandallo** |

Reglas:

- **Solo gastronomía** tiene planes pagos. No-gastro (comercio/servicios/salud) queda en
  `Gratuito` como ficha de **contacto** (sin carrito) — es motor de tráfico/descargas.
- **Moda**: `MODA_FEATURES` en `src/lib/plans.ts` habilita `cart`+`emits_orders` gratis.
  Los planes pagos para moda (pos/límites/precios) siguen pendientes.
- Un plan pago **vencido** cae al fallback `FREE_GASTRO_FEATURES` (carrito + tope de
  pedidos del plan `gratuito`) — no rompe la venta, pero genera urgencia de renovar.
- Todos arrancan en `gratuito` (sin grandfather).

## Dónde viven los valores

- Tabla `plans`: `price_monthly`, `max_products`, **`max_orders_month`**, `features`
  (jsonb), `description`, `badge`, `popular`, `sort`, `promo_*`.
- `max_orders_month`: **NULL = ilimitado**. El `gratuito` trae `20` por defecto.
- Fallbacks en `src/lib/plans.ts`: `GRATUITO_FEATURES` (contacto, no-gastro),
  `FREE_GASTRO_FEATURES` (gastro gratuito/vencido), `MODA_FEATURES`.
- Resolución: `resolveVendorPlan()` → `EffectivePlan` con `can(feature)`,
  `analyticsDays`, `maxProducts` y `maxOrdersMonth`. Para límites, si el vendor es gastro
  sin plan vigente, lee del plan `gratuito` (así el admin configura el tope sin tocar código).

## Aplicación del tope de pedidos

- En `POST /api/orders` (`src/app/api/orders/route.ts`), tras el gate `can("cart")`:
  cuenta pedidos del vendor con `channel='app'`, `status <> 'cancelled'` y
  `created_at >= date_trunc('month', now())`. Si llega a `max_orders_month` responde **403**
  con mensaje claro de upgrade.
- El mes se cuenta en hora UTC del server (desfase ~3h en el cambio de mes; aceptado).
- Uso visible del comercio:
  - `GET /api/subscriptions/me` → `usage.ordersThisMonth / maxOrdersMonth / ordersOverLimit`.
  - Dashboard (`plan-banner`) y `/vendor/suscripcion` muestran "X de 20 pedidos este mes".

## Configuración desde el panel admin (`/admin/planes`)

Editable por plan: `name`, `description`, `price_monthly`, `max_products` (vacío =
ilimitado), `max_orders_month` (vacío = ilimitado), `badge`, `popular`, y la promo
(`promo_price`, `promo_months`, `promo_ends_at`, `promo_label`). Aplicado vía
`PATCH /api/admin/plans` (lista ALLOWED).

## Módulo Recetas / escandallo (gastronomía, plan Gestión integral)

- Feature flag `recipes` en `plans.features` (solo `gestion` en `true`; ver
  `supabase/self-host/migrate-recipes.sql`). Gate con `can("recipes")` en APIs y tab.
- Tablas: `ingredients` (insumo: unidad base g/ml/u, costo sin IVA, % merma,
  `is_elaborated`), `recipes` (cabecera: un plato **o** un elaborado, con `portions`
  = rinde), `recipe_items` (insumo + cantidad **neta** + unidad).
- Aritmética en `src/lib/costing.ts` (pura, estilo Fudo): bruta = neta ÷ (1−merma),
  línea = bruta × costo, total = Σ (+ recursión en sub-recetas con guardia
  anti-ciclos), food-cost % = costo ÷ precio, semáforo 🟢<30 🟡30–35 🔴>35,
  precio sugerido = costo ÷ food-cost objetivo.
- El costo del plato **se deriva siempre** (no se persiste): al cambiar un insumo se
  recalcula todo lo que lo usa. UI: tab **Recetas** (`RecipeManager`) + chip de
  food-cost en el Menú. Alcance v1: solo costeo informativo (sin descuento de
  stock al vender, sin CMV/teórico-vs-real — fase 2).

## Migración

`supabase/self-host/migrate-order-limit.sql`:

```sql
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_orders_month integer;

UPDATE public.plans SET max_products = NULL, max_orders_month = 20,
  features = features || '{"cart": true, "emits_orders": true}'::jsonb
WHERE slug = 'gratuito';

UPDATE public.plans SET max_products = NULL, max_orders_month = NULL WHERE slug = 'pedidos';
UPDATE public.plans SET max_orders_month = NULL WHERE slug = 'gestion';
```

Correrla en el contenedor:

```
docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-order-limit.sql
```

## Benchmark de precios (referencia de mercado)

Todo en ARS/mes, software gastronómico que también vende "pedidos sin comisión de apps":

- Fudo: $22.500 (Inicial) · $43.900 (Avanzado) · $69.500 (Pro) + módulos.
- OlaClick: free (10 pedidos/mes) · ~USD 8/mes (75) · ~USD 17/mes (400).

Portal 659 arranca ~4x por debajo de Fudo a propósito (precio de capilaridad en un
barrio); hay margen de suba una vez validada la tracción. El modelo de tope por pedidos
(no por productos) sigue el patrón de OlaClick: el plan gratis deja usar todo el menú y
se cobra cuando el negocio crece.