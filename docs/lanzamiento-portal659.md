# Lanzamiento Portal 659 — El centro comercial de tu barrio

Zona: **Sicardi + Garibaldi** (la "Avenida 659"). Marca: **Portal 659**, identidad verde pino + amarillo sol.

## Propuesta de valor

**"El centro comercial de tu barrio, en tu pantalla."** — Todo Sicardi y Garibaldi a un clic.

- Hub multicommerce hiperlocal: **Gastronomía**, **El Almacén** y **Servicios del Barrio**
- Cada comercio tiene su micrositio `/tienda/[slug]` con QR
- El cliente pide o consulta sin registrarse y todo cae en el WhatsApp del comercio
- **0% comisión** (a diferencia de PedidosYa/Rappi que cobran 20-35%)
- Los servicios y oficios publican **gratis** (electricistas, plomeros, jardineros) → los vecinos bajan la app por los servicios

## Modelo de negocio

| Producto | Precio sugerido | Notas |
|---|---|---|
| **Plan Comunidad** | Cuota fija mensual baja (valor de 2-3 pizzas) | Previsibilidad para el comercio; no toca margen por pedido |
| **Destacados Premium** | Extra mensual | Aparecer primero en la home el fin de semana (mapea al flag `featured_today`) |
| **Oficios y Servicios** | Gratis | Motor de descargas de la app; genera demanda de vecinos |

Estrategia: primero máxima cantidad de servicios (multicommerce completo), monetizar después con el Plan Comunidad y los destacados.

## Fase 1: Arranque gratis con comercios locales

- Incorporar rotiserías, verdulerías, almacenes y **cocineras caseras** de Sicardi y Garibaldi gratis (sin comisión, sin costo de alta)
- Objetivo: 5-10 comercios cargados + 2-3 servicios/oficios antes del lanzamiento público
- Vender el micrositio como "tu vidriera en el barrio" + WhatsApp directo

## Fase 2: Campaña de lanzamiento en redes

### Posteo 1 — Intriga
> Imagen: fondo verde texturado con el texto en grande:
> **"¿Cansado de pedir los menús por WhatsApp uno por uno?"**
> Texto al pie: "Algo nuevo está llegando a la Avenida 659. Todo Sicardi y Garibaldi en un solo lugar. Muy pronto... 📲✨"

### Posteo 2 — Beneficio
> Imagen: el logo de Portal 659.
> Texto al pie: "Llega la primera aplicación multinegocio de la zona. Compras, delivery, servicios y los comercios de siempre, directo en tu celular. Si tenés un comercio o servicio en el barrio, escribinos por privado para sumarte antes del lanzamiento."

### Otros canales
- **Grupos de Facebook de Sicardi/Garibaldi**: publicar los comercios y la oferta del día
- **Estados de WhatsApp**: promos de la semana, "la oferta de hoy"
- **Stickers con QR** en las cajas de los locales aliados (al micrositio del local o a la home)
- Volantes por debajo de las puertas en el radio cercano a los locales

## Fase 3: Métricas a validar (primeras 4 semanas)

- Pedidos/consultas por comercio por semana (dashboard del vendedor)
- Qué vertical engancha más (gastronomía vs almacén vs servicios) para priorizar
- % de pedidos que llegan al WhatsApp (conversión)
- % de conversión free → Plan Comunidad (cuando se lance la monetización)

## Backlog de producto

- **Fase 2 (producto)**: Info del barrio / Alerta Vecinal (colectivos Línea Este, teléfonos útiles) — tabla `info_items` + página `/barrio`
- **Fase 3 (producto)**: Plan Comunidad (suscripción), Destacados Premium (fin de semana), estadísticas para vendedores
- Pagos con Mercado Pago (link manual primero, sin Stripe)
- Confirmación de pedido desde el WhatsApp del local hacia la app
- Más barrios: Arana y Correas

## Notas de seguridad pendientes

- `setup.ps1` tiene la `SUPABASE_SERVICE_ROLE_KEY` del proyecto remoto commiteada → rotarla antes de que el repo sea público
- El push a GitHub expone la contraseña vieja ya commiteada en el historial
- `/api/seed` (GET) queda expuesto en producción → bloquearlo
