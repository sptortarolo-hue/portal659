-- Proveedores: nombre único por comercio (case-insensitive).
-- Evita que reintentos fallidos de compras/facturas creen 5 filas duplicadas.
-- IMPORTANTE: correr primero la limpieza de duplicados
-- (supabase/self-host/cleanup-duplicate-suppliers.sql) si ya los hay.

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_vendor_name_lower_key
  ON public.suppliers (vendor_id, lower(btrim(name)));
