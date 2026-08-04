# Portal 659 — Plan de producto multicommerce

## Visión

Convertir la app de un MVP gastronómico ("SeMorfa") en **Portal 659**: el centro comercial de Sicardi y Garibaldi en una sola pantalla. Tres verticales de comercio + contenido de barrio.

## Verticales

| Vertical | Slug | Qué es | Flujo |
|---|---|---|---|
| Gastronomía | `gastronomia` | Rotiserías, pizzerías, comida casera | Menú + carrito + pedido WhatsApp + dashboard |
| El Almacén | `almacen` | Verdulerías, carnicerías, kioscos | Catálogo con precios/unidades + carrito + pedido WhatsApp |
| Servicios del Barrio | `servicio` | Oficios y profesionales | **Solo contacto**: descripción + "Consultar por WhatsApp". Sin precios ni pedidos |

## Fase 1 — Núcleo multicommerce (implementado)

1. **Migración `007_vendor_vertical.sql`**: `vendors.vertical` (`gastronomia | almacen | servicio | otro`, default `gastronomia`). Aplicar con `supabase db push`.
2. **Registro**: selector "¿Qué tipo de emprendimiento tenés?" (Comida / Almacén / Servicio / Solo quiero pedir). `role` + `vertical` en `user_metadata`; `comprador` → role `buyer`.
3. **Dashboard**: select "Tipo de comercio" en onboarding y configuración. Vertical `servicio` oculta menú/categorías/pedidos y muestra la "vidriera de servicio" (config + QR + "Compartí tu QR").
4. **Micrositio** (`/tienda/[slug]`): `servicio` → layout de contacto con botón "Consultar por WhatsApp" (sin carrito ni precios).
5. **Home hub**: 3 secciones por vertical (Gastronomía, El Almacén, Servicios del Barrio) con anclas. "La oferta de hoy" solo para gastronomía/almacén.
6. **Seed**: + Verdulería (almacen) y Electricista (servicio) con `test123456`.

### Archivos clave

- `supabase/migrations/007_vendor_vertical.sql`
- `src/lib/config.ts` → `VERTICALS`
- `src/app/register/page.tsx` + `src/app/api/register/route.ts`
- `src/app/vendor/dashboard/page.tsx` (vertical + vista servicio)
- `src/app/api/vendor/me/route.ts` (persiste `vertical`)
- `src/app/tienda/[slug]/page.tsx` (layout servicio)
- `src/app/page.tsx` (hub 3 verticales)
- `scripts/seed.mjs` + `src/app/api/seed/route.ts`

## Fase 2 — Info del barrio (Alerta Vecinal)

- Tabla `info_items` (categoría: `transporte | utilidades | horarios`, título, cuerpo, vigencia)
- Página `/barrio`: colectivos **Línea Este**, teléfonos útiles, avisos
- Contenido curado (sin CMS) al inicio; los servicios gratis son el gancho de descargas

## Fase 3 — Monetización

- **Plan Comunidad**: suscripción mensual baja (valor de 2-3 pizzas)
- **Destacados Premium**: extra para aparecer primero en la home el fin de semana → reutiliza `featured_today`
- **Oficios gratis**: se mantienen siempre gratis (motor de tráfico)

## Decisiones tomadas

- Marca: **Portal 659** (Avenida 659 = Sicardi + Garibaldi). Identidad: verde pino `#1f4d32` + amarillo sol `#f5b800`, tipografía blanca sobre verde.
- Monetización: documentada, **postergada** hasta completar el multicommerce.
- Servicios: **solo contacto por WhatsApp**, sin precios ni pedidos.
- Primero comercio, Info del barrio después.

## Fuera de alcance hoy

- Arana / Correas (siguientes barrios)
- Pagos online (Mercado Pago)
- CMS de contenido / sección Info
- Rol admin real
