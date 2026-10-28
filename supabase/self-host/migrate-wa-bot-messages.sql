-- ============================================================
-- Portal 659 — Historial de conversaciones del bot de WhatsApp.
-- Almacena cada mensaje (entrante y saliente) por comercio y cliente
-- para que el panel muestre el historial de chat.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wa_bot_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  wa_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_bot_messages_vendor_wa ON public.wa_bot_messages (vendor_id, wa_id);
CREATE INDEX IF NOT EXISTS idx_wa_bot_messages_created ON public.wa_bot_messages (created_at);
CREATE INDEX IF NOT EXISTS idx_wa_bot_messages_vendor_created ON public.wa_bot_messages (vendor_id, created_at DESC);

COMMENT ON TABLE public.wa_bot_messages IS
  'Historial de mensajes del bot de WhatsApp por comercio y cliente.';