-- Moderación de reseñas: reporte por comercio + moderación por admin
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reported BOOLEAN DEFAULT FALSE;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS report_reason TEXT;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS moderated BOOLEAN DEFAULT FALSE;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS moderated_by TEXT;

CREATE INDEX IF NOT EXISTS idx_reviews_reported ON reviews(reported) WHERE reported = TRUE;
CREATE INDEX IF NOT EXISTS idx_reviews_moderated ON reviews(moderated) WHERE moderated = TRUE;
