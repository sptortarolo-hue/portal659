-- ============================================================================
-- Taller "multirrubro": equipos celular/PC + default que ya no es bici.
-- ----------------------------------------------------------------------------
-- El vertical taller dejó de ser solo bicicletería: sirve igual para motos,
-- autos, electrodomésticos, servicio técnico de celulares y PC. Esta migración
-- agrega los dos tipos que faltaban al CHECK de equipment.kind y cambia el
-- default de 'bici' a 'otro' (antes toda ficha nueva nacía bicicleta; ahora el
-- tipo se infiere del rubro del comercio o lo elige el usuario).
--
-- Aplicar contra el contenedor (ver AGENTS.md):
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-equipment-kinds.sql
-- Idempotente: busca el constraint por definición, no por nombre.
-- Sin aplicarla todo sigue funcionando: el servidor guarda celular como
-- 'electro' y pc como 'otro' (fallback, nunca rompe el CHECK).
-- ============================================================================

-- Reemplazar el CHECK de kind por el ampliado (puede existir más de una
-- instancia: la del CREATE TABLE y alguna agregada a mano; se reconstruyen
-- todas las que mencionen kind).
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'public.equipment'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.equipment DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.equipment
    ADD CONSTRAINT equipment_kind_check
    CHECK (kind IN ('bici', 'moto', 'automotor', 'electro', 'celular', 'pc', 'otro'));
END $$;

-- Nuevas fichas ya no nacen "bici": nacen 'otro' y el código elige por rubro.
ALTER TABLE public.equipment ALTER COLUMN kind SET DEFAULT 'otro';
