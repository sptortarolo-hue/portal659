-- ============================================================
-- Portal 659 Envíos — avisos a la logística (v4)
-- ============================================================
-- 1) carriers.wa_phones / wa_invite_url: el comercio puede avisar por WhatsApp
--    a varios despachantes o a un grupo de la logística (además del `phone`
--    histórico, que se sigue usando como primer teléfono).
-- 2) shipments.ack_at / ack_by_profile: acuse de recibo del encargo (el
--    operador logueado abrió el panel y lo vio) — el comercio lo ve en el
--    bloque violeta del pedido.
--
-- Idempotente y tolerante: si no se aplica, todo sigue funcionando como hoy
-- (WA al `phone` único, sin acuse).
-- ============================================================

ALTER TABLE carriers ADD COLUMN IF NOT EXISTS wa_phones text;
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS wa_invite_url text;

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ack_at timestamptz;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ack_by_profile uuid;

COMMENT ON COLUMN carriers.wa_phones IS 'Teléfonos WA del despacho separados por coma (además de phone)';
COMMENT ON COLUMN carriers.wa_invite_url IS 'Link de invitación al grupo de WhatsApp de la logística (opcional)';
COMMENT ON COLUMN shipments.ack_at IS 'Primera vez que un operador de la logística vio el encargo en su panel';
COMMENT ON COLUMN shipments.ack_by_profile IS 'Perfil del operador que acusó recibo (nullable: operadores sin cuenta)';

-- El panel listá los pendientes de acuse por carrier; índice parcial chico.
CREATE INDEX IF NOT EXISTS idx_shipments_ack_pending
  ON shipments (carrier_id) WHERE ack_at IS NULL;
