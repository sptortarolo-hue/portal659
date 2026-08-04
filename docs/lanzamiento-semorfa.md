# Lanzamiento SeMorfa App — MVP Sicardi

## Propuesta de valor

**"El delivery de nuestro barrio"** — Donde las aplicaciones grandes no llegan, nosotros te salvamos la cena.

- Galería gastronómica hiperlocal (MVP: Sicardi; + Garibaldi y Arana)
- Cada local tiene su micrositio `/tienda/[slug]`
- El cliente pide sin registrarse (guest) y el pedido cae en el WhatsApp del local
- 0% comisión (a diferencia de PedidosYa/Rappi que cobran 20-30%)

## Fase 1: Arranque gratis con rotiserías locales

- Incorporar las primeras rotiserías de Sicardi **gratis** (sin comisión, sin costo de alta)
- Objetivo: conseguir 5-10 locales cargados con su menú completo antes del lanzamiento público
- Vender el micrositio como "tu vidriera en el barrio" + WhatsApp directo

## Fase 2: Boca a boca en el barrio

- **Stickers con QR**: pegados en las cajas de pizza/empanadas que salen de los locales aliados, con el QR al micrositio del local (o a la home de SeMorfa)
- **Grupos de Facebook de Sicardi**: publicar los locales y la oferta del día
- **Estados de WhatsApp**: promos de la semana, "la oferta de hoy"
- Volantes por debajo de las puertas en el radio cercano a los locales

## Fase 3: Métricas a validar (primeras 4 semanas)

- Pedidos por local por semana (el vendedor los confirma en su dashboard)
- Qué local engancha más (para duplicar el modelo en Garibaldi y Arana)
- % de pedidos que llegan al WhatsApp (conversión)

## Backlog de producto (fase 2)

- Pagos con Mercado Pago
- Confirmación de pedido desde el WhatsApp del local hacia la app
- Más barrios: Garibaldi y Arana
- Panel con estadísticas para vendedores

## Notas de seguridad pendientes

- `setup.ps1` tiene la `SUPABASE_SERVICE_ROLE_KEY` del proyecto remoto commiteada → rotarla antes de que el repo sea público
- El push a GitHub expone la contraseña vieja ya commiteada en el historial
