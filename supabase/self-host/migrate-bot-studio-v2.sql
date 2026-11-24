-- Bot Studio v2 — brief del agente + base de conocimiento (preguntas y respuestas).
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-bot-studio-v2.sql
--
-- Sin esta migración el panel sigue funcionando con nombre/tono/saludo/modo/handoff
-- de la Fase 1; los campos nuevos aparecen vacíos y no rompen nada.

ALTER TABLE public.bot_agents
  ADD COLUMN IF NOT EXISTS brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS model text;

CREATE TABLE IF NOT EXISTS public.bot_agent_faqs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key  text NOT NULL REFERENCES public.bot_agents(key) ON DELETE CASCADE,
  question   text NOT NULL,
  answer     text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bot_agent_faqs_key ON public.bot_agent_faqs (agent_key);

-- Limpieza del seed de la Fase 1: el vendor interno del bot central NO es un agente.
DELETE FROM public.bot_agents
WHERE vendor_id IN (
  SELECT id FROM public.vendors
  WHERE slug IN ('portal659-bot', 'portal-central', 'admin-portal659')
);
