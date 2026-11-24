-- Bot Studio v3 — ajustes de modelo por agente.
-- Aplicar:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-bot-studio-model.sql
--
-- `model` ya existe en bot_agents (Fase 2); acá se agregan los parametros
-- de generacion y se dejan defaults neutros (temperatura 0 = modo actual).

ALTER TABLE public.bot_agents
  ADD COLUMN IF NOT EXISTS temperature numeric(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_tokens integer NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS memory_limit integer NOT NULL DEFAULT 16;

UPDATE public.bot_agents
SET temperature = 0, max_tokens = 600, memory_limit = 16
WHERE temperature IS NULL OR max_tokens IS NULL OR memory_limit IS NULL;
