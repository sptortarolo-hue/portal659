# QA moda — flujo end-to-end

Checklist de verificación de la vertical moda (indumentaria) en producción, con un comercio de prueba.

> Convención: `[ ]` pendiente · `[x]` OK · `[⚠️]` con desvío (anotarlo en la tabla del final).

---

## Fase 0 — Preparar

- [ ] Registrar comercio de prueba con **vertical moda** (registro público). Dueño + panel accesible.
- [ ] Abrir el modo prueba desde Config → link de preview (los pedidos de prueba no cuentan al tope ni descuentan stock: ideal para Fase 1 y 3).
- [ ] Para probar el **tope del plan** y el **apartado con MP** (Fase 2) usar pedidos reales: conectar la cuenta MP del comercio de prueba (card MP en el panel) o pagar por transferencia.
- [ ] Panel abierto en PC + sesión cliente (celular o ventana incognito) mirando el micrositio.

## Fase 1 — Catálogo (panel del comercio)

**Producto con variantes**
- [ ] Alta: tildar "Usar variantes (color × talle)" → filas color/talle/precio/promo/stock/SKU; botón `⚡ Códigos` rellena los SKU que falten.
- [ ] Ficha pública: selector Color + Talle, stock por variante y **la foto cambia al elegir un color** (galería con color asignado).
- [ ] Guardar y **recargar el panel**: las variantes persisten.

**Producto con pack**
- [ ] Alta sin variantes: campo "Se vende de a…" (ej. 3) → el precio cargado es **por paquete**.
- [ ] Ficha pública: chip `📦 Pack x3`, stepper en múltiplos de 3, agregar suma paquetes al carrito.

**Guía de talles**
- [ ] Copiar plantilla (ej. remera) → la ficha muestra la tabla junto al selector de talles.

**Vistas nuevas del catálogo**
- [ ] **Categorías**: crear 2–3 y reordenar (↑↓) → el orden se refleja en el micrositio.
- [ ] **Opciones**: crear modificador (ej. "Grabado +$500") y asignarlo al producto → la ficha lo muestra.
- [ ] **Precios por volumen**: crear regla "llevá N x $X" → se ve en la vista.
- [ ] **Combos**: armar un combo de 2 productos desde la vista Combos (form genérico) y **recargar el panel** → el combo sigue ahí (valida el fix de persistencia `is_combo`/`combo_items`).

## Fase 2 — Compra online (cliente)

- [ ] Comprar producto con variante: el checkout muestra "Color Rojo · Talle M" tal cual se eligió.
- [ ] Comprar pack: cantidad 2 → total = precio-del-pack × 2.
- [ ] Regla de volumen aplicando en el checkout cuando llega al umbral.
- [ ] Comprar combo: al confirmar, **el stock de los componentes descuenta** (verificar stock en el panel).
- [ ] **Combo armable (M5)**: combo con componente que tiene variantes → al tocarlo se abre el armado (
  una casilla por pieza: chips color → talle). Confirmar y revisar que el carrito muestre el desglose 🧩
  por pieza ("Lisa (Blanca · M)") y que el stock de la **variante** elegida descuenta.
- [ ] Mismo combo con otro armado (distinta variante) → entra como **línea separada** del carrito.
- [ ] Intentar pedir más unidades de las definidas (bcc editando) → error claro en el checkout.
- [ ] **Apartado**: elegir apartado → pagar seña por MP → pedido queda apartado con saldo restante visible (seguimiento / mis-pedidos).
- [ ] Flow retail del pedido: Empaquetando → Listo → (si delivery) Enviado con franja; notificaciones al cliente en cada paso.
- [ ] WhatsApp de seguimiento muestra estado y franja correctos.

## Fase 3 — Plan pago + Mostrador

**Tope del plan gratuito**
- [ ] Con plan gratuito: hasta 5 pedidos del mes; el 6º → mensaje de tope (no se cobra).

**Plan Pedidos ($4.990)**
- [ ] Suscribir → tope desaparece + analytics 7 días.

**Plan Gestión ($12.990)**
- [ ] Suscribir (o activar por admin) → aparecen **Mostrador, Caja, Gastos, Clientes** en el menú.
- [ ] Confirmar que **Comanda / Mesas / Preparación y Costo no aparecen** (mask del vertical).

**Mostrador (POS)**
- [ ] Vender producto con variantes: picker de color/talle en el mostrador.
- [ ] **Combo armable en mostrador**: tocar un combo con componente variantable → el mismo armado del
  micrositio; la línea lleva el desglose 🧩 y el ticket subraya cada pieza.
- [ ] Escanear SKU de una variante (si hay escáner; si no, saltear).
- [ ] Venta directa → ticket impreso (o confirmación en pantalla si no hay impresora).
- [ ] Caja: abrir turno → vender → cerrar Z con arqueo.

## Fase 4 — Bordes

- [ ] Cancelar pedido con variante (estaba "nuevo") → **el stock de la variante se repone**.
- [ ] Cancelar pedido de **combo armado** → repone el stock de las variantes de las piezas.
- [ ] Combo pedido por un canal viejo (MP webhook / bot) con componente variantable → rechazado con
  mensaje claro ("falta elegir talle y color de …"); si el combo no pide variantes, entra normal.
- [ ] Editar combo (quitar componente y guardar) → pedidos ya hechos no rompen; ficha queda correcta.
- [ ] Producto con mods + promo al mismo tiempo: precio correcto en checkout y mostrador (con `cash_discount_excluded` correspondiente).
- [ ] Bajar el plan (admin, a gratuito) → Mostrador/Caja vuelven a lock y el tope vuelve aplicar.

---

## Fase 5 — Cancelación con motivo (M4.1) y "Pago vencido" (M4.2)

**M4.1 — motivo**
- [ ] Rechazar un pedido (moda) → pide motivo (presets: Sin stock / A pedido del cliente / Se agotó / Cerramos + texto libre); el motivo **obligatorio**.
- [ ] El cliente recibe push con el motivo; en **mis-pedidos** y **seguimiento** se ve "Motivo de la cancelación: …".
- [ ] Kanban de cancelados muestra `🚫 motivo`; el detalle del pedido también.
- [ ] Requiere migración `migrate-cancel-reason.sql` en el VPS (sin migrar: cancela igual, sin motivo visible).

**M4.2 — vencimiento de transferencias**
- [ ] Config (moda) → "Transferencia: vencimiento del pago" → elegir 2h.
- [ ] Pedido online con transferencia pendiente → al vencer se cancela solo; el stock se repone; giftcard emitida se anula.
- [ ] ~1h antes de vencer llega al comercio: "⏳ Transferencia por vencer" (un aviso por pedido).
- [ ] El kanban muestra badge rojo "⏰ Pago vencido" en el pendiente vencido (hasta que el cron lo cancele).
- [ ] Marcar cobrado antes de vencer lo congela (no se cancela).
- [ ] El cliente recibe "pago no llegó en el tiempo acordado" en push/in-app.
- [ ] Requiere migración `migrate-transfer-expiry.sql` + cron line (deploy la auto-escribe al pushear).

## Notas / desvíos encontrados

| # | Fase | Qué pasó | Fix/commit |
|---|------|----------|------------|
|   |      |          |            |
|   |      |          |            |
|   |      |          |            |
