-- migrate-salud-vertical.sql
-- Vertical "Salud y Bienestar" (slug `salud`): terapias holísticas (reiki, tarot,
-- videncia, mesa cuántica, coaching). Reutiliza toda la maquinaria híbrida de
-- estética (turnera, servicios, packs, giftcards, mostrador, caja, CRM) — no
-- crea tablas nuevas. `salud` ya está en el CHECK de vendors.vertical desde el
-- schema base y las migraciones de estética/taller, así que este archivo es
-- idempotente y no cambia datos. Se documenta acá para dejar trazabilidad.

ALTER TABLE public.vendors DROP CONSTRAINT IF EXISTS vendors_vertical_check;
ALTER TABLE public.vendors
  ADD CONSTRAINT vendors_vertical_check
  CHECK (vertical IN ('gastronomia', 'comercio', 'servicio', 'moda', 'salud', 'estetica', 'taller', 'varios', 'mascotas', 'otro'));