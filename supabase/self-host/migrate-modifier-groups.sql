-- Modificadores muchos a muchos: un grupo definido una vez se asigna a 1..N platos.
-- Reemplaza a product_modifiers (1 fila por plato, duplicaba group_name/options).

CREATE TABLE IF NOT EXISTS public.modifier_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  group_name text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT false,
  max_selections int NOT NULL DEFAULT 1,
  is_variant boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_modifier_groups_vendor ON public.modifier_groups(vendor_id);

CREATE TABLE IF NOT EXISTS public.product_modifier_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.modifier_groups(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_pml_product ON public.product_modifier_links(product_id);
CREATE INDEX IF NOT EXISTS idx_pml_group ON public.product_modifier_links(group_id);

-- Backfill: deduplicar product_modifiers existentes en grupos (por vendor + group + options).
INSERT INTO public.modifier_groups (vendor_id, group_name, options, required, max_selections, is_variant)
SELECT DISTINCT p.vendor_id, pm.group_name, pm.options, pm.required, pm.max_selections, false
FROM public.product_modifiers pm
JOIN public.products p ON p.id = pm.product_id
ON CONFLICT DO NOTHING;

-- Linkear cada (grupo, plato).
INSERT INTO public.product_modifier_links (group_id, product_id, position)
SELECT g.id, pm.product_id, pm.position
FROM public.product_modifiers pm
JOIN public.products p ON p.id = pm.product_id
JOIN public.modifier_groups g
  ON g.vendor_id = p.vendor_id
 AND g.group_name = pm.group_name
 AND g.options = pm.options
 AND g.required = pm.required
 AND g.max_selections = pm.max_selections
ON CONFLICT DO NOTHING;