-- ============================================================
-- migrate-product-packaging.sql — Empaque por producto (comercio de barrio)
--
-- El empaque es una capa OPCIONAL por producto, independiente de
-- Preparación y Costo / Envasado. El comercio que no envasa desde granel
-- puede cargar bolsas, etiquetas y contenedores sin armar una receta.
--
-- Modelo:
--   * Los envases viven en la biblioteca de insumos (ingredients), con su
--     costo unitario (cost_per_unit) que se actualiza al comprarlos.
--   * product_packaging es la relación producto ↔ insumo de empaque (qty).
--   * products.packaging_mode:
--       'none'      → sin empaque (default, no cambia nada)
--       'category'  → hereda el empaque por defecto de su CATEGORÍA
--       'simple'    → override del producto (se SUMA al costo)
--       'in_recipe' → producto envasado desde granel: el empaque YA está
--                     dentro del costo del lote (NO se suma de nuevo)
--
-- Resolución: override del producto > default de la categoría > sin empaque.
-- Se carga una sola vez por categoría (no producto por producto). Los
-- productos que no la cambian nacen en modo 'category'.
--   * products.packaging_cost es DERIVADO (mantenido por trigger):
--       SUM(qty × ingredients.cost_per_unit), redondeado a 4 decimales.
--       Si el modo no es 'simple' queda en 0.
--
-- Costo efectivo = products.cost_last + products.packaging_cost.
-- Ese es el número que deben usar el asistente de precios, bulk-price,
-- listas de margen y el snapshot de margen real (orders.items[].cost).
--
-- Reejecutable (IF NOT EXISTS / CREATE OR REPLACE / DROP + CREATE trigger).
-- Sin aplicar: las APIs de empaque responden 503 nombrando este archivo y
-- el resto del panel funciona exactamente como antes (packaging_cost = 0).
--
-- Requiere migrate-recipes.sql (tabla public.ingredients) aplicada antes.
--
-- Aplicar:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-product-packaging.sql
-- ============================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS packaging_mode text NOT NULL DEFAULT 'none';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS packaging_cost numeric(12,4) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_packaging_mode_check') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_packaging_mode_check
      CHECK (packaging_mode IN ('none', 'category', 'simple', 'in_recipe'));
  END IF;
END $$;

-- Si se corrió una versión anterior de esta migración, el CHECK viejo hay
-- que reemplazarlo para poder usar el modo 'category'.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_packaging_mode_check'
             AND pg_get_constraintdef(oid) NOT LIKE '%category%') THEN
    ALTER TABLE public.products DROP CONSTRAINT products_packaging_mode_check;
    ALTER TABLE public.products
      ADD CONSTRAINT products_packaging_mode_check
      CHECK (packaging_mode IN ('none', 'category', 'simple', 'in_recipe'));
  END IF;
END $$;

COMMENT ON COLUMN public.products.packaging_mode IS
  'none = sin empaque; category = hereda packaging_defaults de la categoría; simple = override del producto (se suma al costo); in_recipe = empaque ya incluido en el lote de envasado (no se suma).';

COMMENT ON COLUMN public.products.packaging_cost IS
  'Costo de empaque por unidad vendida, derivado (modo simple: product_packaging; modo category: packaging_defaults de la categoría) × ingredients.cost_per_unit. 0 en none/in_recipe. Se suma a cost_last para pricing y margen real.';

CREATE TABLE IF NOT EXISTS public.product_packaging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  -- Cantidad de ese insumo que lleva UNA unidad del producto (1 bolsa, 1 etiqueta, ...).
  qty numeric(10,3) NOT NULL DEFAULT 1 CHECK (qty > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_packaging_unique UNIQUE (product_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_product_packaging_vendor ON public.product_packaging(vendor_id);
CREATE INDEX IF NOT EXISTS idx_product_packaging_ingredient ON public.product_packaging(ingredient_id);

COMMENT ON TABLE public.product_packaging IS
  'Override de empaque por producto. Cada fila apunta a un insumo de la biblioteca (bolsa, etiqueta, contenedor) con la cantidad usada por unidad vendida.';

-- ============================================================
-- DEFAULT POR CATEGORÍA: se carga UNA vez y lo heredan todos los
-- productos de esa categoría (patrón Dots / InnoBooks). El producto
-- puede salirse con un override (mode='simple') o quedar sin empaque.
-- category_key = lower(trim(products.category)).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.packaging_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  category_key text NOT NULL CHECK (length(category_key) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT packaging_defaults_unique UNIQUE (vendor_id, category_key)
);

CREATE TABLE IF NOT EXISTS public.packaging_default_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  default_id uuid NOT NULL REFERENCES public.packaging_defaults(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  qty numeric(10,3) NOT NULL DEFAULT 1 CHECK (qty > 0),
  CONSTRAINT packaging_default_lines_unique UNIQUE (default_id, ingredient_id)
);

CREATE INDEX IF NOT EXISTS idx_packaging_defaults_vendor ON public.packaging_defaults(vendor_id);
CREATE INDEX IF NOT EXISTS idx_packaging_default_lines_ingredient ON public.packaging_default_lines(ingredient_id);

COMMENT ON TABLE public.packaging_defaults IS
  'Empaque por defecto de una categoría del catálogo. Los productos con packaging_mode=category lo heredan; no hace vista cargarlo uno por uno.';

-- ============================================================
-- Recálculo derivado. Se dispara al cambiar las líneas, el precio del
-- insumo o el modo del producto. Así "actualizás la bolsa una vez y se
-- recalculan todos los productos que la usan" sin código en cada pantalla.
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_product_packaging_cost(p_product_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_mode text;
  v_vendor uuid;
  v_cat text;
  v_sum numeric;
BEGIN
  SELECT packaging_mode, vendor_id, lower(trim(COALESCE(category, '')))
    INTO v_mode, v_vendor, v_cat
    FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_mode = 'simple' THEN
    SELECT SUM(pp.qty * i.cost_per_unit)
      INTO v_sum
      FROM public.product_packaging pp
      JOIN public.ingredients i ON i.id = pp.ingredient_id
     WHERE pp.product_id = p_product_id;
  ELSIF v_mode = 'category' THEN
    SELECT SUM(dl.qty * i.cost_per_unit)
      INTO v_sum
      FROM public.packaging_defaults d
      JOIN public.packaging_default_lines dl ON dl.default_id = d.id
      JOIN public.ingredients i ON i.id = dl.ingredient_id
     WHERE d.vendor_id = v_vendor AND d.category_key = v_cat;
  END IF;

  UPDATE public.products
     SET packaging_cost = COALESCE(ROUND(v_sum, 4), 0)
   WHERE id = p_product_id;
END $$;

CREATE OR REPLACE FUNCTION public.trg_product_packaging_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.recalc_product_packaging_cost(NEW.product_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS product_packaging_after_write ON public.product_packaging;
CREATE TRIGGER product_packaging_after_write
  AFTER INSERT OR UPDATE ON public.product_packaging
  FOR EACH ROW EXECUTE FUNCTION public.trg_product_packaging_changed();

CREATE OR REPLACE FUNCTION public.trg_product_packaging_deleted()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.recalc_product_packaging_cost(OLD.product_id);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS product_packaging_after_delete ON public.product_packaging;
CREATE TRIGGER product_packaging_after_delete
  AFTER DELETE ON public.product_packaging
  FOR EACH ROW EXECUTE FUNCTION public.trg_product_packaging_deleted();

CREATE OR REPLACE FUNCTION public.trg_ingredient_packaging_price()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  -- Overrides por producto.
  FOR r IN
    SELECT DISTINCT product_id FROM public.product_packaging WHERE ingredient_id = NEW.id
  LOOP
    PERFORM public.recalc_product_packaging_cost(r.product_id);
  END LOOP;
  -- Productos que heredan el default de su categoría.
  FOR r IN
    SELECT DISTINCT p.id
      FROM public.products p
      JOIN public.packaging_defaults d
        ON d.vendor_id = p.vendor_id
       AND d.category_key = lower(trim(COALESCE(p.category, '')))
      JOIN public.packaging_default_lines dl ON dl.default_id = d.id
     WHERE dl.ingredient_id = NEW.id AND p.packaging_mode = 'category'
  LOOP
    PERFORM public.recalc_product_packaging_cost(r.id);
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ingredient_packaging_price_changed ON public.ingredients;
CREATE TRIGGER ingredient_packaging_price_changed
  AFTER UPDATE OF cost_per_unit ON public.ingredients
  FOR EACH ROW EXECUTE FUNCTION public.trg_ingredient_packaging_price();

-- Cambiar el default de una categoría recalcula TODOS sus productos.
CREATE OR REPLACE FUNCTION public.recalc_default_category_products(p_default_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_vendor uuid;
  v_cat text;
  r record;
BEGIN
  SELECT vendor_id, category_key INTO v_vendor, v_cat
    FROM public.packaging_defaults WHERE id = p_default_id;
  IF NOT FOUND THEN RETURN; END IF;
  FOR r IN
    SELECT id FROM public.products
     WHERE vendor_id = v_vendor
       AND lower(trim(COALESCE(category, ''))) = v_cat
       AND packaging_mode = 'category'
  LOOP
    PERFORM public.recalc_product_packaging_cost(r.id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.trg_packaging_default_lines_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.recalc_default_category_products(NEW.default_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS packaging_default_lines_after_write ON public.packaging_default_lines;
CREATE TRIGGER packaging_default_lines_after_write
  AFTER INSERT OR UPDATE ON public.packaging_default_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_packaging_default_lines_changed();

CREATE OR REPLACE FUNCTION public.trg_packaging_default_lines_deleted()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.recalc_default_category_products(OLD.default_id);
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS packaging_default_lines_after_delete ON public.packaging_default_lines;
CREATE TRIGGER packaging_default_lines_after_delete
  AFTER DELETE ON public.packaging_default_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_packaging_default_lines_deleted();

-- Borrar un default (o cambiar su categoría) también debe limpiar el costo
-- heredado: los trigers de líneas ya no encuentran la fila en ese momento.
CREATE OR REPLACE FUNCTION public.trg_packaging_default_deleted()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.products
     SET packaging_cost = 0
   WHERE vendor_id = OLD.vendor_id
     AND lower(trim(COALESCE(category, ''))) = OLD.category_key
     AND packaging_mode = 'category';
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS packaging_defaults_before_delete ON public.packaging_defaults;
CREATE TRIGGER packaging_defaults_before_delete
  BEFORE DELETE ON public.packaging_defaults
  FOR EACH ROW EXECUTE FUNCTION public.trg_packaging_default_deleted();

CREATE OR REPLACE FUNCTION public.trg_packaging_default_category_changed()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  IF NEW.category_key IS DISTINCT FROM OLD.category_key THEN
    UPDATE public.products
       SET packaging_cost = 0
     WHERE vendor_id = OLD.vendor_id
       AND lower(trim(COALESCE(category, ''))) = OLD.category_key
       AND packaging_mode = 'category';
    FOR r IN
      SELECT id FROM public.products
       WHERE vendor_id = NEW.vendor_id
         AND lower(trim(COALESCE(category, ''))) = NEW.category_key
         AND packaging_mode = 'category'
    LOOP
      PERFORM public.recalc_product_packaging_cost(r.id);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS packaging_defaults_after_category_change ON public.packaging_defaults;
CREATE TRIGGER packaging_defaults_after_category_change
  AFTER UPDATE OF category_key ON public.packaging_defaults
  FOR EACH ROW EXECUTE FUNCTION public.trg_packaging_default_category_changed();

-- El modo o la categoría del producto cambian cuánto empaque hereda.
CREATE OR REPLACE FUNCTION public.trg_product_packaging_mode()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.packaging_mode IS DISTINCT FROM OLD.packaging_mode
     OR NEW.category IS DISTINCT FROM OLD.category THEN
    PERFORM public.recalc_product_packaging_cost(NEW.id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS product_packaging_mode_changed ON public.products;
CREATE TRIGGER product_packaging_mode_changed
  AFTER UPDATE OF packaging_mode, category ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.trg_product_packaging_mode();
