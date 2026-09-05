-- Migración: activa stock_control en productos de indumentaria (moda) con variantes.
-- Motivo: el editor de moda no guardaba stock_control, por lo que el micrositio no
-- gateaba el stock de las variantes, pero el backend (adjustStockForItems) sí lo
-- descontaba. Esto dejaba los dos lados inconsistentes y los pedidos fallaban al
-- confirmar con "Sin stock suficiente" para variantes con stock 0.
UPDATE products p
SET stock_control = true
FROM vendors v
WHERE p.vendor_id = v.id
  AND v.vertical = 'moda'
  AND p.has_variants = true
  AND p.stock_control IS NOT TRUE;