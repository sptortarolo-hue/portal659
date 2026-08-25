-- 021: Variantes de productos (indumentaria / moda)
-- Aislado: solo afecta a productos con variantes (has_variants). Las demás categorías no cambian.

-- ============================================================
-- 1. Columna has_variants en products
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.products ADD COLUMN has_variants boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- 2. Tabla product_variants (color × talle, precio y stock por combinación)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  color text NOT NULL,
  talle text NOT NULL,
  price numeric(10,2) NOT NULL,
  promo numeric(10,2),
  stock integer NOT NULL DEFAULT 0,
  sku text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants(product_id);

-- ============================================================
-- 3. Galería de fotos por producto
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON public.product_images(product_id);

-- ============================================================
-- 4. RLS
-- ============================================================
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public read variants" ON public.product_variants;
  CREATE POLICY "Public read variants" ON public.product_variants FOR SELECT USING (true);

  DROP POLICY IF EXISTS "Vendors manage own variants" ON public.product_variants;
  CREATE POLICY "Vendors manage own variants" ON public.product_variants
    USING (product_id IN (SELECT id FROM public.products WHERE vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())))
    WITH CHECK (product_id IN (SELECT id FROM public.products WHERE vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())));
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Public read product images" ON public.product_images;
  CREATE POLICY "Public read product images" ON public.product_images FOR SELECT
    USING (true);

  DROP POLICY IF EXISTS "Vendors manage own product images" ON public.product_images;
  CREATE POLICY "Vendors manage own product images" ON public.product_images
    USING (product_id IN (SELECT id FROM public.products WHERE vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())))
    WITH CHECK (product_id IN (SELECT id FROM public.products WHERE vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())));
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;