-- ============================================================
-- Multi-cuenta para transferencias (hasta 3 por comercio).
--
-- Antes: UNA sola cuenta en vendors.transfer_alias / transfer_cbu /
-- transfer_holder. Ahora: tabla `vendor_bank_accounts` (hasta 3
-- activas, una marcada como principal). Cada cobro por transferencia
-- registra A QUÉ cuenta entró la plata, así la Caja (Z/X/consolidado)
-- y Analytics desglosan "Transferencia" por cuenta.
--
-- Modelo (patrón ERP "cuentas bancarias" + Loyverse "ventas por tipo
-- de pago"):
--  - `order_payments.bank_account_id` → desglose por fila de cobro
--    (mostrador combinado, cierre de mesa, cobro parcial).
--  - `orders.bank_account_id` → pedidos por transferencia SIN filas
--    (mostrador medio único, online) y la cuenta que se le mandó al
--    cliente al compartir los datos de pago (los reenvíos usan la misma).
--  - `bookings.bank_account_id` → cobro de turno/orden por transferencia.
--  - `cash_closings.by_account` → snapshot del desglose al cerrar el Z
--    (jsonb nullable: los Z viejos no tienen desglose).
--
-- La columna vieja de vendors NO se borra: queda como espejo/fallback
-- para comercios sin cuentas cargadas (el checkout dice "el comercio te
-- contacta por WhatsApp" igual que siempre).
--
-- Backfill: cada comercio con alias/CBU cargado recibe su cuenta
-- "Principal" (is_default). Idempotente (NOT EXISTS).
--
-- Fix incluido: pedidos de mostrador con pago combinado insertaban
-- filas en order_payments SIN marcar paid_via_payments (solo el cierre
-- de mesa lo marcaba) → la Caja los sumaba dos veces (por el total del
-- pedido Y por las filas). El UPDATE de abajo deja consistente lo ya
-- registrado y pos/order marca el flag desde ahora.
--
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-bank-accounts.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.vendor_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  -- Nombre corto visible ("MP personal", "Banco Nación", "Cuenta del local").
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  alias text CHECK (alias IS NULL OR char_length(alias) <= 60),
  cbu text CHECK (cbu IS NULL OR char_length(cbu) <= 40),
  holder text CHECK (holder IS NULL OR char_length(holder) <= 80),
  position int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Sin datos no tiene sentido: alias y/o CBU (puede cargar solo uno).
  CHECK (alias IS NOT NULL OR cbu IS NOT NULL)
);

-- Una sola cuenta principal por comercio.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_bank_accounts_default
  ON public.vendor_bank_accounts(vendor_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS idx_vendor_bank_accounts_vendor
  ON public.vendor_bank_accounts(vendor_id, position);

-- updated_at automático (misma función compartida del esquema).
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vendor_bank_accounts_updated ON public.vendor_bank_accounts;
CREATE TRIGGER trg_vendor_bank_accounts_updated
  BEFORE UPDATE ON public.vendor_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Cuenta destino en los cobros.
ALTER TABLE public.order_payments
  ADD COLUMN IF NOT EXISTS bank_account_id uuid
  REFERENCES public.vendor_bank_accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_order_payments_bank_account
  ON public.order_payments(bank_account_id) WHERE bank_account_id IS NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS bank_account_id uuid
  REFERENCES public.vendor_bank_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS bank_account_id uuid
  REFERENCES public.vendor_bank_accounts(id) ON DELETE SET NULL;

-- Snapshot del desglose por cuenta en el Z (NULL = cierre sin desglose,
-- incluidos todos los Z anteriores a esta migración).
ALTER TABLE public.cash_closings
  ADD COLUMN IF NOT EXISTS by_account jsonb;

-- Backfill: la cuenta vieja del comercio pasa a ser su cuenta "Principal".
INSERT INTO public.vendor_bank_accounts (vendor_id, label, alias, cbu, holder, position, active, is_default)
SELECT v.id, 'Principal',
       NULLIF(v.transfer_alias, ''), NULLIF(v.transfer_cbu, ''), NULLIF(v.transfer_holder, ''),
       0, true, true
FROM public.vendors v
WHERE (NULLIF(v.transfer_alias, '') IS NOT NULL OR NULLIF(v.transfer_cbu, '') IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.vendor_bank_accounts a WHERE a.vendor_id = v.id);

-- Fix de consistencia (ver encabezado): todo pedido con filas de cobro
-- queda marcado para que la Caja no lo cuente dos veces.
UPDATE public.orders
SET paid_via_payments = true
WHERE paid_via_payments = false
  AND id IN (SELECT DISTINCT order_id FROM public.order_payments
             WHERE kind = 'cobro' AND order_id IS NOT NULL);
