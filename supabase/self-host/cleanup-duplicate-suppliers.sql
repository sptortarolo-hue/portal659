-- Limpieza de proveedores duplicados por nombre dentro de un comercio.
-- Conserva el más antiguo de cada grupo y reasigna todas las referencias.
-- Correr ANTES de migrate-supplier-unique-name.sql. Idempotente.

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY vendor_id, lower(btrim(name))
           ORDER BY created_at ASC
         ) AS keep_id
  FROM public.suppliers
)
UPDATE public.products p
   SET supplier_id = r.keep_id
  FROM ranked r
 WHERE p.supplier_id = r.id AND r.id <> r.keep_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY vendor_id, lower(btrim(name))
           ORDER BY created_at ASC
         ) AS keep_id
  FROM public.suppliers
)
UPDATE public.purchases p
   SET supplier_id = r.keep_id
  FROM ranked r
 WHERE p.supplier_id = r.id AND r.id <> r.keep_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY vendor_id, lower(btrim(name))
           ORDER BY created_at ASC
         ) AS keep_id
  FROM public.suppliers
)
UPDATE public.supplier_pricelists sp
   SET supplier_id = r.keep_id
  FROM ranked r
 WHERE sp.supplier_id = r.id AND r.id <> r.keep_id;

WITH ranked AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY vendor_id, lower(btrim(name))
           ORDER BY created_at ASC
         ) AS keep_id
  FROM public.suppliers
)
DELETE FROM public.suppliers s
 USING ranked r
 WHERE s.id = r.id AND r.id <> r.keep_id;
