-- Bot Studio / IA del portal — contabilidad de tokens y costo.
-- Aplicar:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-llm-usage.sql
--
-- No guarda prompts ni respuestas: sólo contadores, modelo, origen y costo.
-- Sin esta migración los endpoints responden 503 con el nombre del archivo y
-- el bot/facturas siguen funcionando igual (fire-and-forget).

CREATE TABLE IF NOT EXISTS public.llm_usage (
  id               bigserial PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  source           text NOT NULL CHECK (source IN ('bot','facturas','playground','lab','test')),
  agent_key        text,
  vendor_id        text,
  provider         text NOT NULL,
  model            text NOT NULL,
  prompt_tokens    integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens     integer NOT NULL DEFAULT 0,
  calls            integer NOT NULL DEFAULT 1,
  cost_usd         numeric(12,6),
  cost_source      text NOT NULL DEFAULT 'none' CHECK (cost_source IN ('provider','estimate','none')),
  success          boolean NOT NULL DEFAULT true,
  latency_ms       integer,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS llm_usage_occurred_idx ON public.llm_usage (occurred_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_source_day_idx ON public.llm_usage (source, occurred_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_agent_day_idx ON public.llm_usage (agent_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS llm_usage_provider_day_idx ON public.llm_usage (provider, occurred_at DESC);

-- Anti-spam de alertas de presupuesto (una por proveedor/período/umbral).
CREATE TABLE IF NOT EXISTS public.llm_budget_alert_log (
  provider   text NOT NULL,
  period     text NOT NULL,
  threshold  integer NOT NULL,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, period, threshold)
);

-- Presupuestos mensuales declarados (null = sin tope declarado).
-- OpenRouter no lo necesita: se lee de GET /api/v1/key.
INSERT INTO public.portal_settings (key, value, updated_at) VALUES
  ('llm_budget_gemini',    'null'::jsonb, now()),
  ('llm_budget_groq',      'null'::jsonb, now()),
  ('llm_budget_openrouter','null'::jsonb, now())
ON CONFLICT (key) DO NOTHING;
