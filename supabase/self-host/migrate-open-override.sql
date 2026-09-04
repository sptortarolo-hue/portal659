-- Sobrescritura manual de apertura del local (dashboard vendor).
-- NULL  → se resuelve por los horarios cargados (vendors.hours).
-- true  → forzado abierto (aunque esté fuera de horario).
-- false → forzado cerrado (no se aceptan pedidos online).
-- Plan acordado con el usuario: manual + horarios; la validación se hace en
-- POST /api/orders y los badges usan el mismo criterio en cliente.

ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS open_override boolean;
