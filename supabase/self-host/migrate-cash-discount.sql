-- Descuento en efectivo (global por comercio + exclusión por promo).
-- vendors.cash_discount_pct: % de descuento (0-100) aplicado cuando el
--   cliente paga en efectivo. NULL/0 = sin descuento. Solo tiene efecto si
--   "Efectivo" está en vendors.payment_methods.
-- products.cash_discount_excluded: true = la promo de ese producto NO recibe
--   el descuento (el comercio lo elige por promo).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-cash-discount.sql

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS cash_discount_pct numeric(5, 2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cash_discount_excluded boolean NOT NULL DEFAULT false;
-- Detalle del descuento en el pedido (para ticket/WhatsApp: precio normal +
-- línea de descuento, no valor directo).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cash_discount numeric(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cash_pct numeric(5, 2) NOT NULL DEFAULT 0;
