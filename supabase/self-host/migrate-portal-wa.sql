-- ============================================================
-- Portal 659 — Número WA central del portal (para avisar a la
-- logística). Reutiliza la infra de Portal Wa Link: el número
-- central es un vendor con is_portal=true que se vincula con
-- vendor_wa_bots. Sin migración aplicada, el envío por WA queda
-- deshabilitado y todo sigue con push + wa.me manual.
-- ============================================================

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_portal boolean DEFAULT false;

-- Índice parcial: a lo sumo un vendor central por plataforma.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_portal_unique
  ON vendors (is_portal) WHERE is_portal = true;

COMMENT ON COLUMN vendors.is_portal IS 'Vendor del número central de WhatsApp de Portal 659 (avisos a logística).';
