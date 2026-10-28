-- ============================================================
-- Portal 659 Envíos v2 — tarifa de la logística + cobro al retirar
-- + autoregistro de logísticas.
--
-- Modelo: el portal arma el catálogo de zonas (shipping_zones) y
-- cada logística define SU tarifa por zona (carrier_zone_rates). Al
-- avisar a la logística la tarifa se congela en shipments.carrier_fee
-- (snapshot, igual que orders.delivery_fee). El cobro al local se
-- hace al retirar y queda en shipment_payments (pending = deuda).
--
-- Todo tolerante: sin aplicar, el panel funciona como hoy (sin cobro
-- ni tarifas) y el autoregistro responde 503 nombrando la migración.
-- ============================================================

-- 1) Tarifa que cada logística cobra al local, por zona.
CREATE TABLE IF NOT EXISTS public.carrier_zone_rates (
  carrier_id uuid NOT NULL REFERENCES public.carriers(id) ON DELETE CASCADE,
  shipping_zone_id uuid NOT NULL REFERENCES public.shipping_zones(id) ON DELETE CASCADE,
  fee numeric(10,2) NOT NULL DEFAULT 0 CHECK (fee >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (carrier_id, shipping_zone_id)
);
COMMENT ON TABLE public.carrier_zone_rates IS 'Tarifa que la logística le cobra al local por envío de esa zona. La edita la logística en su panel (o el admin).';

-- 2) Snapshot de la tarifa en el encargo (historial estable).
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS carrier_fee numeric(10,2);

-- 3) Cobro al retirar: un pago por encargo (UNIQUE shipment_id).
CREATE TABLE IF NOT EXISTS public.shipment_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL UNIQUE REFERENCES public.shipments(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  carrier_id uuid REFERENCES public.carriers(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL CHECK (amount >= 0),
  method text NOT NULL DEFAULT 'efectivo'
    CHECK (method IN ('efectivo','transferencia','tarjeta','mixto','fiado')),
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending')),
  payer_name text,
  note text,
  paid_at timestamptz,
  collected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shipment_payments_carrier ON public.shipment_payments(carrier_id, status);
CREATE INDEX IF NOT EXISTS idx_shipment_payments_vendor ON public.shipment_payments(vendor_id, status);
CREATE INDEX IF NOT EXISTS idx_shipment_payments_pending ON public.shipment_payments(carrier_id) WHERE status = 'pending';
COMMENT ON TABLE public.shipment_payments IS 'Cobro de la logística al local al retirar el paquete. status=pending = deuda documentada del local.';

-- 4) Autoregistro de logísticas: datos + origen + estado.
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS self_registered boolean NOT NULL DEFAULT false;
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS coverage text;
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS vehicle text;
-- Índice parcial para la cola de aprobación del admin.
CREATE INDEX IF NOT EXISTS idx_carriers_pending ON public.carriers(created_at) WHERE self_registered = true AND active = false;

-- 5) Rol 'carrier' en profiles (menú + permisos del operador).
-- El CHECK original no tiene nombre explícito: se busca y reemplaza el que
-- toque la columna role (así no queda duplicado ni falla el ADD).
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c);
  END LOOP;
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('buyer', 'vendor', 'admin', 'carrier'));
END $$;
