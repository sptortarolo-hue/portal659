-- ============================================================
-- Portal 659 — Eventos del bot de WhatsApp (telemetría persistente).
-- Registra cada evento del bot (mensaje entrante, respuesta, handoff,
-- pedido creado, carrito abandonado, etc.) para métricas históricas.
-- Fase 1: solo conteos por día. Fase 2: dashboard con gráficos.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wa_bot_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  wa_id text,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_bot_events_vendor ON public.wa_bot_events (vendor_id);
CREATE INDEX IF NOT EXISTS idx_wa_bot_events_type ON public.wa_bot_events (event_type);
CREATE INDEX IF NOT EXISTS idx_wa_bot_events_created ON public.wa_bot_events (created_at);
CREATE INDEX IF NOT EXISTS idx_wa_bot_events_vendor_type_created ON public.wa_bot_events (vendor_id, event_type, created_at);

COMMENT ON TABLE public.wa_bot_events IS
  'Eventos del bot de WhatsApp para métricas históricas (mensajes, handoffs, pedidos, etc.).';