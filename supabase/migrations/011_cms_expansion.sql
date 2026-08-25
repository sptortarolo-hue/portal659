-- 011: CMS Expansion - Modifiers, Gallery, Stock, Scheduling, Urgency

-- ============================================================
-- 1. Modificadores de producto (gastronomía, moda, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.product_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  group_name text NOT NULL,          -- "Tamaño", "Extras", "Sin/Con"
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- options: [{"label":"Con fritas","price_mod":0},{"label":"Sin fritas","price_mod":0}]
  required boolean NOT NULL DEFAULT false,
  max_selections int NOT NULL DEFAULT 1,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_modifiers_product ON public.product_modifiers(product_id);

-- ============================================================
-- 2. Galería de fotos (servicios, moda, portafolio)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vendor_gallery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  caption text,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_gallery_vendor ON public.vendor_gallery(vendor_id);

-- ============================================================
-- 3. Columnas nuevas en vendors
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.vendors ADD COLUMN prep_time_min int;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.vendors ADD COLUMN urgent_enabled boolean NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- 4. Columnas nuevas en products
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.products ADD COLUMN stock_low_threshold int DEFAULT 5;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.products ADD COLUMN promo_price numeric(10,2);
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- ============================================================
-- 5. RLS policies (allow vendor access)
-- ============================================================
ALTER TABLE public.product_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_gallery ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Vendors manage own modifiers" ON public.product_modifiers;
  CREATE POLICY "Vendors manage own modifiers" ON public.product_modifiers
    USING (product_id IN (SELECT id FROM public.products WHERE vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid())));

  DROP POLICY IF EXISTS "Public read modifiers" ON public.product_modifiers;
  CREATE POLICY "Public read modifiers" ON public.product_modifiers FOR SELECT USING (true);
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Vendors manage own gallery" ON public.vendor_gallery;
  CREATE POLICY "Vendors manage own gallery" ON public.vendor_gallery
    USING (vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid()));

  DROP POLICY IF EXISTS "Public read gallery" ON public.vendor_gallery;
  CREATE POLICY "Public read gallery" ON public.vendor_gallery FOR SELECT USING (true);
EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL;
END $$;
