-- Lo más pedido: excluir líneas manuales ("Monto" del mostrador/mesa, con
-- product_id "manual:...") y pedidos de prueba. Sin esto, un monto manual
-- repetido aparece como "producto más vendido" aunque no existe como tal.
-- Función pura (CREATE OR REPLACE): se puede aplicar en cualquier momento.
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/fix-most-ordered-manual.sql
CREATE OR REPLACE FUNCTION get_most_ordered_products(
  p_days int DEFAULT 7,
  p_limit int DEFAULT 5,
  p_zone text[] DEFAULT NULL
)
RETURNS TABLE(
  product_id text,
  product_name text,
  total_qty bigint,
  store_name text,
  store_slug text,
  store_vertical text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    item->>'product_id' AS product_id,
    item->>'name' AS product_name,
    SUM((item->>'qty')::numeric)::bigint AS total_qty,
    v.store_name,
    v.slug AS store_slug,
    v.vertical AS store_vertical
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(o.items) AS item
  JOIN vendors v ON v.id = o.vendor_id
  WHERE o.created_at > now() - (p_days || ' days')::interval
    AND o.status NOT IN ('cancelled')
    AND COALESCE(o.is_preview, false) = false
    AND (item->>'product_id') IS NOT NULL
    AND (item->>'product_id') != ''
    AND (item->>'product_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND COALESCE((item->>'manual')::boolean, false) = false
    AND (p_zone IS NULL OR v.neighborhood = ANY(p_zone))
  GROUP BY item->>'product_id', item->>'name', v.store_name, v.slug, v.vertical
  ORDER BY total_qty DESC
  LIMIT p_limit;
$$;
