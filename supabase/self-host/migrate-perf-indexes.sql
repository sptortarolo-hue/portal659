-- Índices faltantes detectados en la auditoría de rendimiento (sep 2026).
-- vendors.user_id se consulta en CADA request autenticado (getVendorByRequest,
-- gateRequest) y no tenía índice; products.vendor_id lo usa /api/vendor/offers
-- (Mesas/Mostrador). Con tablas chicas el costo es bajo, pero son gratis.

CREATE INDEX IF NOT EXISTS idx_vendors_user ON public.vendors(user_id);
CREATE INDEX IF NOT EXISTS idx_products_vendor ON public.products(vendor_id);
