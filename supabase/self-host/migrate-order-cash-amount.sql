-- "¿Con cuánto abonás?" — pedidos online pagados en efectivo con delivery.
-- `orders.cash_amount`: monto con el que el cliente dice que va a abonar
-- (para que el comercio sepa cuánto vuelto llevar el repartidor).
-- NULL = no informado (pedidos viejos, retiro, o comercio con el pedido del dato apagado).
-- `vendors.cash_ask_amount`: toggle por comercio (NULL/true = se pide el dato, false = no se pide).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cash_amount numeric(12, 2);
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS cash_ask_amount boolean;
