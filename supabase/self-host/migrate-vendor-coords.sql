-- Migración: coordenadas exactas de comercios para el mapa interactivo
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS lng double precision;
