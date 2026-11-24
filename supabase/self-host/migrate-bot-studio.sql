-- Bot Studio (Fase 1) — configuración de agentes de WhatsApp por tenant.
-- Un solo motor (services/wa-bot), N configuraciones. El bot central del portal
-- también es un agente: su key es 'portal' y vendor_id NULL.
--
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-bot-studio.sql
--
-- Falla abierto: si el cerebro no ve esta tabla, sigue decidiendo por slug/env
-- exactamente como antes. Hasta que no se aplica, el comportamiento no cambia.

CREATE TABLE IF NOT EXISTS public.bot_agents (
  key            text PRIMARY KEY,              -- 'portal' o vendor_id::text
  vendor_id      uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
  name           text NOT NULL,
  mode           text NOT NULL DEFAULT 'concierge'
                 CHECK (mode IN ('concierge', 'orders')),
  enabled        boolean NOT NULL DEFAULT false, -- switch "debe responder"
  tone           text NOT NULL DEFAULT 'humano'
                 CHECK (tone IN ('clasico', 'humano')),
  greeting       text,
  handoff_phone  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_agents_vendor ON public.bot_agents (vendor_id);

-- Seed: refleja el estado actual del día 1 (cero cambios de comportamiento).
INSERT INTO public.bot_agents (key, vendor_id, name, mode, enabled, tone)
VALUES ('portal', NULL, 'Portal 659 central', 'orders', true, 'humano')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.bot_agents (key, vendor_id, name, mode, enabled)
SELECT v.id::text, v.id, v.store_name, 'concierge', COALESCE(vb.enabled, false)
FROM public.vendors v
LEFT JOIN public.vendor_wa_bots vb ON vb.vendor_id = v.id
WHERE NOT EXISTS (
  SELECT 1 FROM public.bot_agents b WHERE b.key = v.id::text
);

-- Todo comercio nuevo arranca con su agente en conserje y apagado.
CREATE OR REPLACE FUNCTION public.bot_agent_for_new_vendor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.bot_agents (key, vendor_id, name, mode, enabled)
  VALUES (NEW.id::text, NEW.id, NEW.store_name, 'concierge', false)
  ON CONFLICT (key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bot_agent_for_new_vendor ON public.vendors;
CREATE TRIGGER trg_bot_agent_for_new_vendor
AFTER INSERT ON public.vendors
FOR EACH ROW EXECUTE FUNCTION public.bot_agent_for_new_vendor();
