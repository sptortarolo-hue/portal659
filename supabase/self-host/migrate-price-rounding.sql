-- ============================================================
-- migrate-price-rounding.sql — Reglas de redondeo de precios
-- (Fase A del plan "costo → ganancia → precio").
--
-- Dos niveles, como Dux/VTEX:
--   margin_lists.price_round_*  → regla POR LISTA (precede).
--   vendors.price_round_*       → regla GLOBAL del comercio (fallback para
--                                 productos sin lista; la usan también los
--                                 precios masivos y el sugerido del recetario).
--
-- Defaults neutros (1 / 'nearest' / 0) === el Math.round a entero que el
-- sistema YA aplicaba en listas y masivo: sin la migración aplicada el
-- comportamiento no cambia; con ella aplicada, tampoco, hasta que el
-- comercio configure la regla.
--
-- Reejecutable (ADD COLUMN IF NOT EXISTS / DO $$ duplicate).
-- ============================================================

-- 1) vendors (global) -------------------------------------------------------
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS price_round_step numeric(10, 2) NOT NULL DEFAULT 1;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS price_round_mode text NOT NULL DEFAULT 'nearest';
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS price_round_tail numeric(10, 2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.vendors ADD CONSTRAINT vendors_price_round_mode_check
    CHECK (price_round_mode IN ('nearest', 'up', 'down'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.vendors ADD CONSTRAINT vendors_price_round_step_check
    CHECK (price_round_step > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.vendors ADD CONSTRAINT vendors_price_round_tail_check
    CHECK (price_round_tail >= 0 AND price_round_tail < price_round_step);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) margin_lists (por lista) ----------------------------------------------
ALTER TABLE public.margin_lists ADD COLUMN IF NOT EXISTS price_round_step numeric(10, 2) NOT NULL DEFAULT 1;
ALTER TABLE public.margin_lists ADD COLUMN IF NOT EXISTS price_round_mode text NOT NULL DEFAULT 'nearest';
ALTER TABLE public.margin_lists ADD COLUMN IF NOT EXISTS price_round_tail numeric(10, 2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.margin_lists ADD CONSTRAINT margin_lists_price_round_mode_check
    CHECK (price_round_mode IN ('nearest', 'up', 'down'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.margin_lists ADD CONSTRAINT margin_lists_price_round_step_check
    CHECK (price_round_step > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.margin_lists ADD CONSTRAINT margin_lists_price_round_tail_check
    CHECK (price_round_tail >= 0 AND price_round_tail < price_round_step);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Comentarios (para el panel y dumps) ------------------------------------
COMMENT ON COLUMN public.vendors.price_round_step IS 'Regla global de redondeo de precios calculados: múltiplo (1 = sin redondeo especial)';
COMMENT ON COLUMN public.vendors.price_round_mode IS 'nearest (mitad abajo/mitad arriba, empate arriba) | up | down';
COMMENT ON COLUMN public.vendors.price_round_tail IS 'Offset dentro del múltiplo: 0 = múltiplo exacto; 0.99 o 99 = terminación';
COMMENT ON COLUMN public.margin_lists.price_round_step IS 'Redondeo de la lista (precede a la global del comercio): múltiplo';
COMMENT ON COLUMN public.margin_lists.price_round_mode IS 'nearest | up | down';
COMMENT ON COLUMN public.margin_lists.price_round_tail IS 'Offset dentro del múltiplo (terminación)';
