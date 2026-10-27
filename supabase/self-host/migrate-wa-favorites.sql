-- ============================================================
-- Portal 659 — Favoritos del cliente (WhatsApp del portal).
-- Guarda las tiendas favoritas de un cliente identificado por teléfono.
-- El bot del portal usa esta tabla para ofrecer "pedir de tus favoritos".
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wa_customer_favorites (
  phone text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (phone, vendor_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_customer_favorites_phone
  ON public.wa_customer_favorites (phone);

COMMENT ON TABLE public.wa_customer_favorites IS
  'Tiendas favoritas de un cliente del portal bot, identificado por teléfono (sin cuenta).';