ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS attachment_urls jsonb NOT NULL DEFAULT '[]'::jsonb;
