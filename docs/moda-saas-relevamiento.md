# Vertical moda (ropa y accesorios) — Relevamiento de SaaS y plan de mejoras

> Portal 659 — "El centro comercial de tu barrio". Hub multicommerce hiperlocal.
> Este doc junta el relevamiento de los mejores SaaS de moda y accesorios y el
> plan de mejoras para la vertical `moda`, ordenado en fases (A–D).
> Fecha: sep-2026. Fuentes consultadas en vivo (Tiendanube, Shopify, True Fit, Syte).

---

## 1. Relevamiento — qué ofrecen los SaaS líderes de moda y accesorios

### 1.1 Tiendanube (referente directo mercado AR/LatAm)

Página de funcionalidades (2026):

- **Checkout transparente y confiable**: checkout sin salir de la tienda, "7% más conversiones", checkout acelerado con datos guardados, visual con la marca del local, y **recursos inteligentes en el checkout**: cross-selling, envío gratis progresivo, descuentos automáticos y mensajes de urgencia.
- **IA integrada**: descripciones de productos automáticas, generación de páginas institucionales (políticas de devolución, "sobre nosotros"), sugerencias de categorías de Google Shopping, edición de imágenes (quitar fondos, ajustar colores, borrar objetos), SEO con IA.
- **Promociones**: cupones de descuento **programados** (hora de inicio/fin), descuentos progresivos ("comprá más, pagá menos"), **"comprá también"** (recomendaciones complementarias), cross-selling con descuento instantáneo al agregar un ítem, carrito de compra rápida (autoabrir / notificación).
- **Canales de venta**: tienda online, redes sociales (Instagram, Facebook, WhatsApp, Google, Pinterest, TikTok), marketplaces (Mercado Libre), y **punto de venta** (local físico + online con stock unificado).
- **Estadísticas**: reportes de ventas y marketing, análisis financiero, análisis de cohortes (plan Evolución), exportación de datos, control de usuarios y permisos.
- **Soluciones integradas**: Pago Nube, Envío Nube (seguimiento automático), Marketing Nube, **Chat Nube** (atención por WhatsApp 24/7 con IA, "de la consulta al checkout sin salir de la conversación").

**Insight para Portal 659**: el apartado/seña y el pago por WhatsApp son nativos del ecommerce argentino; el cross-selling en checkout y el carrito abandonado son palancas de ticket promedio.

### 1.2 Shopify (global) — POS y ecommerce

Páginas consultadas: `/pos`, `/pricing` (2026).

- **POS (Point of Sale)**: software de mostrador + móvil + multicanal. **Inventario unificado** online + tienda física, retiro en tienda, envío local, ventas en eventos/pop-up. **POS Pro** (+$89/mes por local): roles y permisos de staff, inventario en tienda, retiro en tienda, delivery flexible y **exchanges (cambios)**.
- **Planes**: Basic ($19/mo), Grow ($49/mo), Advanced ($299/mo), Plus (desde $2.300/mo). Siempre incluidos: checkout que convierte mejor, temas, venta en persona, multichannel.
- **Funciones de moda/retail**: inventario con múltiples ubicaciones (10 a 200 según plan), "Combined Listings" (variantes como listados separados), productos ilimitados, 200+ reportes, marketing (segmentos, email, SMS, automatizaciones, **códigos de descuento, gift cards, recuperación de carrito abandonado**), globalización (markets, monedas locales).

**Insight**: el flujo de **cambios en mostrador** y el **inventario multicanal unificado** son estándar para tienda de ropa física.

### 1.3 True Fit (fit & sizing intelligence)

SaaS especializado en guía de talles con IA (clientes: Vans, Skechers, Ralph Lauren, lululemon, JCPenney, etc.).

- **Fit Intelligence**: guía de talles personalizada y general por producto, basada en 20 años de datos reales de compra/devolución de +100M de usuarios y 60M+ de productos.
- **Resultados comerciales**: hasta **40% de reducción de devoluciones por talle**, +1-2% de conversión sitewide, +4% de ingresos incrementales.
- **Filtrado por talles**: en PLP permite **filtrar productos disponibles en el talle del comprador** (55% de los listings tienen stockouts).
- **Categorías**: tops, bottoms, denim, kids, performance, intimates, footwear, uniforms.

**Insight**: la guía de talles es la palanca #1 de moda online (menos devoluciones, más conversión). Una tabla simple ya ataca esto; la recomendación personalizada es el estándar premium.

### 1.4 Syte (visual AI / product discovery)

SaaS de descubrimiento visual para moda (clientes: Farfetch, PrettyLittleThing, Prada, Decathlon).

- **Visual Search**: buscar por imagen (foto del usuario o de la web).
- **Recomendaciones visuales**: "Shop Similar", "Shop Social", **"Shop the Look"**, +5 motores más.
- **AI tagging**: etiquetado automático de atributos de producto (color, patrón, tipo) que alimenta búsqueda textual y merchandising.
- **Personalización**: recomendaciones avanzadas por usuario.
- **Resultados**: +7.1x conversión, +40% AOV, +829% ARPU (casos).

**Insight**: búsqueda por imagen y tagging automático son el diferencial premium (alto esfuerzo, baja prioridad para el MVP barrial).

### 1.5 Matriz comparativa

| Capacidad | Tiendanube | Shopify | True Fit | Syte | Portal 659 (hoy) |
|---|---|---|---|---|---|
| Variantes color×talle + stock por combinación | ✅ | ✅ | — | — | ✅ |
| Guía de talles / recomendación de talle | app | app | ✅ | — | ❌ |
| Búsqueda visual / shop-the-look | — | app | — | ✅ | ❌ |
| Filtros PLP por talle/color/precio | ✅ | ✅ | ✅ (por talle disponible) | — | ❌ |
| Fotos por color/variante + carrusel | ✅ | ✅ | — | — | ⚠️ parcial (galería por producto) |
| SKU / códigos de barras | ✅ | ✅ | — | — | ⚠️ columna existe, UI manda null |
| Back-in-stock / "avísame" | ✅ | ✅ | — | — | ❌ |
| Pre-venta / lanzamientos | ✅ | ✅ | — | — | ❌ |
| Cupones, descuentos progresivos, cross-selling | ✅ | ✅ | — | — | ❌ |
| Carrito abandonado + email/SMS | ✅ | ✅ | — | — | ❌ |
| Gift cards | ✅ | ✅ | — | — | ❌ |
| Reseñas con foto | ✅ | ✅ | — | — | ❌ |
| Wishlist por producto | ✅ | ✅ | — | — | ❌ (solo por comercio) |
| **Apartado / seña (pago parcial + fecha)** | ✅ | — | — | — | ❌ |
| **Cambios y devoluciones (POS)** | ✅ | ✅ POS Pro | — | — | ❌ |
| POS de mostrador con inventario unificado | ✅ | ✅ | — | — | ❌ (Mostrador bloqueado) |
| Analíticas (ventas, cohortes, inventario) | ✅ | ✅ | ✅ | ✅ | ❌ (moda) |
| Venta por WhatsApp/IG/TikTok/ML | ✅ | ✅ | — | — | ⚠️ (WA-bot sin variantes) |

---

## 2. Estado actual de la vertical moda en Portal 659 (verificado en código)

### 2.1 Lo que ya existe

| Capacidad | Dónde |
|---|---|
| Variantes color × talle con stock por combinación | `schema.sql:392-404`, `variant-selector.tsx:35-48`, `product-manager.tsx:384-408` |
| Galería multi-foto (1 portada + 7 extras) | `product-images/route.ts:52-71`, `product-card.tsx:218-231` |
| Precio "Desde $X" con rango + mejor descuento | `product-card.tsx:66-78`, `variantRange` en `tienda/[slug]/page.tsx:223-232` |
| Promo por variante (`promo`) y por producto (`promo_price`) | `variant-selector.tsx:50-51`, `schema.sql:398` |
| Stock con reserva al crear pedido | `order-service.ts:190`, `stock.ts:22-71` |
| Reposición de stock al cancelar/rechazar/borrar | `orders/[id]/route.ts:272-275,378-389` |
| Flow de aceptación explícita (new→confirmed→…→completed) | `order-utils.ts:14-26,146-164,175-203` |
| Labels y pasos moda en todo el panel | `order-utils.ts:146-164`, `vendor/dashboard/page.tsx:637-638`, `orders-kanban.tsx:179` |
| Notificaciones push con wording moda | `orders/[id]/route.ts:38-53,314-343` |
| Botón Rechazar (moda) vs Cancelar | `order-detail-modal.tsx:674` |
| Modificación de ítems con re-stock + re-reserva | `orders/[id]/route.ts:238-241` |
| Carrito con foto miniatura y variante por línea | `cart.tsx:19-44`, `variant-selector.tsx:67` |
| Micrositio: grid de cards 2/3 columnas + ficha fullscreen | `tienda/[slug]/page.tsx:634-649`, `product-card.tsx:168-281` |
| Buscador de catálogo client-side dentro del micrositio | `category-nav.tsx:89-114` |
| Toggle venta online (`accepts_online_orders`) | `dashboard-moda.tsx:580-596`, `plans.ts:200-216` |
| "Sin stock por el momento" + aviso pocas unidades | `product-card.tsx:53-58`, `variant-selector.tsx:39,181` |
| Descuento en efectivo en variantes | `variant-selector.tsx:52-55` |
| Pausar/Activar/Destacar/Eliminar producto | `dashboard-moda.tsx:375-400` |
| Modal con swipe de fotos (gesto) | `product-card.tsx:190-197` |
| Deep link `?cat=` + scroll a producto | `category-nav.tsx:79-87`, `scroll-to-product.tsx` |
| `stock_control` backfill para moda | `migrate-moda-variant-stock.sql:6-12` |
| Seguimiento público por token con timeline moda | `seguimiento/[token]/page.tsx:121-148` |
| Favoritos de comercio | `favorite-button.tsx`, `schema.sql:288-297` |
| Reseñas con respuesta (sin foto) | `schema.sql:248-257`, `review-list.tsx` |
| Emojis placeholder de indumentaria | `product-emoji.ts:73-81,100` |

### 2.2 Carencias (las 22 del inventario)

1. **Guía de talles** — no existe ningún modelo/UI de tabla de talles (ni en el editor ni en la ficha).
2. **Búsqueda/filtros por talle, color, precio o rango** — `/buscar` solo filtra `q`, `vertical`, `online` (`buscar/page.tsx:59`).
3. **Back-in-stock / "Avísame cuando vuelva"** — no hay tabla ni botón.
4. **Pre-venta** — no hay flag de preventa ni fechas de lanzamiento.
5. **Apartado / seña** — no existe (reserva con pago parcial).
6. **Devoluciones / cambios** — no hay estados, motivos, ni flujo.
7. **Outfit / bundles / combos moda** — `volume_groups` es gastro-only (`tienda/[slug]/page.tsx:259`).
8. **SKU / código de barras editable** — columna `sku` existe (`schema.sql:400`) pero la UI manda `null` (`product-manager.tsx:311`, `dashboard-moda.tsx:354`).
9. **Reseñas con foto** — tabla `reviews` sin campo imagen.
10. **Wishlist por producto** — favoritos solo por comercio.
11. **Selector de cantidad en productos con variantes** — `VariantSelector.handleAdd` fuerza `qty:1` (`variant-selector.tsx:59-73`).
12. **POS / Mostrador bloqueado** — `can("pos")=false` para moda (`plans.ts:65-69`), `PlanLock` ("lo estamos habilitando").
13. **Planes pagos no disponibles para moda** — `eligibleForPaid = isGastroVendor` (`plans.ts:161`).
14. **Analytics deshabilitado** — `analyticsDays: 0` (`plans.ts:185`).
15. **Bot de WhatsApp sin soporte de variantes** — `wa-bot/bot.mjs:172` arma ítems sin `variantId`.
16. **Impresión (ticket/comanda) para moda** — `can("printer")=false`.
17. **Cupones / códigos de descuento** — no existe ningún mecanismo.
18. **Fotos por variante (foto por color)** — la galería es por producto, el selector de color no cambia la foto.
19. **Carrusel en la card de grilla** — solo hay swipe dentro de la ficha.
20. **Talle único / "talle único"** — las variantes exigen `color` y `talle` NOT NULL (`schema.sql:395-396`).
21. **Notas/instrucciones de talle en el pedido** — el placeholder de notas para moda es vacío (`checkout/page.tsx:711`).
22. **Manuales y documentación específicos de moda** — `manuales/page.tsx:20` indica "Solo gastronomía".

---

## 3. Plan de mejoras por fases

### Fase A — Fundamentos de producto moda (prioridad alta, bajo esfuerzo)

Objetivo: cerrar el gap básico de "tienda de ropa seria" aprovechando la base existente.

1. **Guía de talles**
   - Migración `supabase/self-host/migrate-size-guide.sql`: `products.size_guide text` + tabla `size_guides` (por vendor/categoría, JSONB).
   - Editor (`dashboard-moda.tsx` + `product-manager.tsx`): textarea "Guía de talles" + guías por categoría.
   - Micrositio: link "📏 Guía de talles" en `variant-selector.tsx` → modal con tabla.
2. **Filtros en `/buscar` para moda** — faceting por talle/color/rango de precio en `buscar/page.tsx` (usa `product_variants` existente, sin migración).
3. **SKU editable** — campo por fila de variante + payload `PUT /api/vendor/variants` (el server ya lo acepta, `variants/route.ts:59`). Etiqueta imprimible opcional.
4. **Cantidad en selector de variantes** — stepper `−/+` en `variant-selector.tsx` respetando stock de la combinación.
5. **Fotos por color** — migración `product_images.color` + API + panel + micrositio (el selector de color cambia la foto).
6. **Carrusel en la card de grilla** — swipe en `product-card.tsx` (patrón ya usado en la ficha).

### Fase B — Conversión y venta

7. **Cupones / códigos de descuento** (decisión de alcance global, no solo moda).
8. **"Comprá también" / cross-selling** por categoría/outfit en ficha y carrito.
9. **Outfits / bundles moda** — extender `pack_size` o modelo combo propio.
10. **Apartado / seña** — reserva con pago parcial + fecha límite + notificación (diferencial AR/LatAm).
11. **Back-in-stock** — tabla + push "¡volvió tu talle!" al reponer stock.
12. **Pre-venta / lanzamiento** — flag + fecha de disponibilidad.

### Fase C — Post-venta y confianza

13. **Devoluciones y cambios** — motivos + estado en el pedido + guía (aprovecha la reposición de stock existente).
14. **Reseñas con foto** — extender `reviews` con campo imagen + upload.
15. **Notas de talle** en el pedido.

### Fase D — Operación y monetización

16. **POS/Mostrador para moda** + cierre de caja (ya hay `CajaManager` en desarrollo) — quitar `PlanLock`.
17. **Planes pagos moda** concordantes con gastro (`plans.ts:161` → `eligibleForPaid`).
18. **Analytics** (`analyticsDays:0` → según plan).
19. **Impresión de ticket** moda (`can("printer")`).
20. **Bot WA con variantes** (`wa-bot/bot.mjs:172` → mandar `variantId`).
21. **Manuales** de moda.

---

## 4. Notas de implementación

- **Migraciones**: se escriben como `.sql` nuevos en `supabase/self-host/` y el usuario las corre contra el contenedor (`docker exec -i portal659-db psql ...`). No se aplican desde el código.
- **Typecheck**: `npx tsc --noEmit`. La working tree puede tener errores pre-existentes de otras features en desarrollo (ej. Caja/CRM); no mezclar.
- **Vertical aislada**: todos los cambios de la Fase A deben ramificar con `isModa`/`esModa` ya existentes; gastro/comercio/servicio mantienen comportamiento actual.