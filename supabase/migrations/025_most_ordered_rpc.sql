-- RPC: get most ordered products in last N days
CREATE OR REPLACE FUNCTION get_most_ordered_products(
  p_days int DEFAULT 7,
  p_limit int DEFAULT 5
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
    SUM((item->>'qty')::int) AS total_qty,
    v.store_name,
    v.slug AS store_slug,
    v.vertical AS store_vertical
  FROM orders o,
       jsonb_array_elements(o.items) AS item
  JOIN vendors v ON v.id = o.vendor_id
  WHERE o.created_at > now() - (p_days || ' days')::interval
    AND o.status NOT IN ('cancelled')
    AND (item->>'product_id') IS NOT NULL
    AND (item->>'product_id') != ''
  GROUP BY item->>'product_id', item->>'name', v.store_name, v.slug, v.vertical
  ORDER BY total_qty DESC
  LIMIT p_limit;
$$;
