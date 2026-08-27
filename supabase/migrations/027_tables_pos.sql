-- 027: Mesas + mostrador (POS) — solo plan Gestión integral (gastronomía)

-- ============================================================
-- 1. Tabla tables (mesas del local)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  capacity integer NOT NULL DEFAULT 4,
  status text NOT NULL DEFAULT 'libre'
    CHECK (status IN ('libre', 'ocupada', 'reservada')),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tables_vendor ON public.tables(vendor_id);

ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Vendor manages own tables" ON public.tables;
CREATE POLICY "Vendor manages own tables"
  ON public.tables FOR ALL
  USING (vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid()))
  WITH CHECK (vendor_id IN (SELECT id FROM public.vendors WHERE user_id = auth.uid()));

-- ============================================================
-- 2. orders: canal de origen + mesa + momento de pago
-- ============================================================
DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN channel text NOT NULL DEFAULT 'app'
    CHECK (channel IN ('app', 'mostrador', 'mesa'));
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN paid_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.orders ADD COLUMN table_id uuid;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_table') THEN
    ALTER TABLE public.orders ADD CONSTRAINT fk_orders_table
      FOREIGN KEY (table_id) REFERENCES public.tables(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_table ON public.orders(table_id);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON public.orders(channel);

-- ============================================================
-- 3. RLS adicional sobre orders para canales internos
-- El vendor ya puede insertar/leer/actualizar sus propias orders
-- (migraciones 002 y 019). No se requieren políticas nuevas.
-- ============================================================