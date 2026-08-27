-- ============================================================
-- MIGRACIÓN SPRINT 5 (multizona) — aplicar en el VPS
-- Ejecutar UNA vez en el Postgres de producción (psql o cliente SQL).
-- Es IDEMPOTENTE: se puede correr varias veces sin romper nada.
--
-- Hace 3 cosas:
--   1) Agrega la columna info_items.zone (default 'sicardi').
--   2) Reemplaza la constraint UNIQUE (category,title) por
--      UNIQUE (zone,category,title) para permitir el mismo ítem
--      en distintos barrios.
--   3) Recrea get_most_ordered_products() con filtro por zona.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Columna zone en info_items
-- ============================================================
ALTER TABLE public.info_items ADD COLUMN IF NOT EXISTS zone text NOT NULL DEFAULT 'sicardi';

-- ============================================================
-- 2. Constraint única: de (category,title) → (zone,category,title)
-- Elimina la constraint vieja sin importar su nombre autogenerado.
-- ============================================================
DO $$
DECLARE
  cons_name text;
BEGIN
  FOR cons_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'info_items'
      AND con.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.info_items DROP CONSTRAINT IF EXISTS %I', cons_name);
    RAISE NOTICE 'Constraint eliminada: %', cons_name;
  END LOOP;
END $$;

-- Recrear la restricción con la zona incluida
ALTER TABLE public.info_items
  ADD CONSTRAINT info_items_zone_category_title_key UNIQUE (zone, category, title);

-- ============================================================
-- 3. Función get_most_ordered_products con filtro por zona
-- ============================================================
CREATE OR REPLACE FUNCTION get_most_ordered_products(
  p_days int DEFAULT 7,
  p_limit int DEFAULT 5,
  p_zone text DEFAULT NULL
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
  FROM orders o
  CROSS JOIN LATERAL jsonb_array_elements(o.items) AS item
  JOIN vendors v ON v.id = o.vendor_id
  WHERE o.created_at > now() - (p_days || ' days')::interval
    AND o.status NOT IN ('cancelled')
    AND (item->>'product_id') IS NOT NULL
    AND (item->>'product_id') != ''
    AND (p_zone IS NULL OR v.neighborhood = p_zone)
  GROUP BY item->>'product_id', item->>'name', v.store_name, v.slug, v.vertical
  ORDER BY total_qty DESC
  LIMIT p_limit;
$$;

-- ============================================================
-- (Opcional) Seed de la Alerta Vecinal para otros barrios
-- Descomentá el bloque que quieras para precargar Arana/Correas.
-- ============================================================
-- INSERT INTO public.info_items (zone, category, title, body, tags, sort) VALUES
--   ('arana', 'noticias', 'Bienvenidos a Arana',
--    'Este es el boletín del barrio de Arana en Portal 659: transporte, utilidades, horarios y avisos.',
--    ARRAY['bienvenida', 'aviso'], 40)
-- ON CONFLICT (zone, category, title) DO NOTHING;
--
-- INSERT INTO public.info_items (zone, category, title, body, tags, sort) VALUES
--   ('correas', 'noticias', 'Bienvenidos a Correas',
--    'Este es el boletín del barrio de Correas en Portal 659: transporte, utilidades, horarios y avisos.',
--    ARRAY['bienvenida', 'aviso'], 40)
-- ON CONFLICT (zone, category, title) DO NOTHING;

COMMIT;