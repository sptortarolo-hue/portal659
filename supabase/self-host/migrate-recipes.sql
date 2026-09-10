-- Módulo Recetas (escandallo) para gastronomía — estilo Fudo.
-- Insumos con costo/merma + recetas por plato (o por insumo elaborado /
-- sub-receta) + líneas de receta. El costo del plato se DERIVA siempre de
-- sus ingredientes (no se persiste), igual que en Fudo.
-- Aplicar contra el contenedor:
--   docker exec -i portal659-db psql -U portal659 -d portal659 < supabase/self-host/migrate-recipes.sql

-- ============================================================
-- INSUMOS (materia prima)
-- base_unit: unidad base en la que se expresa el costo ('g', 'ml' o 'u').
-- cost_per_unit: costo por 1 unidad base, SIN IVA (precio neto de factura).
-- waste_pct: % de merma (0-100). Ej. 5 = de cada 100 g comprados se
--   aprovechan 95 g.
-- is_elaborated: true si es una elaboración propia (salsa, masa, fondo)
--   con receta propia (sub-receta) en la tabla recipes.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name text NOT NULL,
  base_unit text NOT NULL DEFAULT 'g' CHECK (base_unit IN ('g', 'ml', 'u')),
  cost_per_unit numeric(12, 4) NOT NULL DEFAULT 0,
  waste_pct numeric(5, 2) NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct < 100),
  is_elaborated boolean NOT NULL DEFAULT false,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ingredients_vendor ON public.ingredients(vendor_id);
CREATE INDEX IF NOT EXISTS idx_ingredients_vendor_active ON public.ingredients(vendor_id, active);

-- ============================================================
-- RECETAS (cabecera): una por plato de la carta (product_id) O por
-- insumo elaborado (ingredient_id). Exactamente uno de los dos.
-- portions: rinde de la receta (porciones o cantidad en unidad base).
--   Para un plato de carta suele ser 1; para una sub-receta, ej. 1000
--   (1 litro de salsa si el insumo está en ml).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  ingredient_id uuid REFERENCES public.ingredients(id) ON DELETE CASCADE,
  portions numeric(10, 3) NOT NULL DEFAULT 1 CHECK (portions > 0),
  instructions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipes_one_target CHECK (num_nonnulls(product_id, ingredient_id) = 1),
  CONSTRAINT recipes_unique_product UNIQUE (product_id),
  CONSTRAINT recipes_unique_ingredient UNIQUE (ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_recipes_vendor ON public.recipes(vendor_id);
CREATE INDEX IF NOT EXISTS idx_recipes_product ON public.recipes(product_id);
CREATE INDEX IF NOT EXISTS idx_recipes_ingredient ON public.recipes(ingredient_id);

-- ============================================================
-- LÍNEAS DE RECETA: (insumo, cantidad neta, unidad de la línea).
-- qty_net: cantidad NETA que lleva la receta (lo que queda en el plato).
-- unit: unidad en que se expresa (g/kg/ml/L/u...). Debe ser compatible
--   con la base_unit del insumo (peso↔peso, volumen↔volumen, u↔u);
--   la conversión vive en src/lib/costing.ts.
-- La cantidad BRUTA (con merma) y el costo de línea se calculan:
--   bruta = neta / (1 - waste_pct/100)
--   costo = bruta_en_base * cost_per_unit
-- Si el insumo es elaborado, su costo se resuelve recursivamente con
-- su propia receta (costo_porcion = costo_total / portions).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  -- RESTRICT: no se puede borrar un insumo usado en recetas (primero
  -- hay que sacarlo de las recetas), para no romper costos en silencio.
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE RESTRICT,
  qty_net numeric(12, 4) NOT NULL CHECK (qty_net > 0),
  unit text NOT NULL DEFAULT 'g',
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON public.recipe_items(recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_ingredient ON public.recipe_items(ingredient_id);

-- ============================================================
-- FEATURE FLAG: recetas solo en Gestión integral (gastronomía).
-- (featureOf() devuelve false si la key falta, pero se deja explícito
-- para que el panel /admin/planes lo muestre correctamente.)
-- ============================================================
UPDATE public.plans SET features = features || '{"recipes": false}'::jsonb
WHERE slug IN ('gratuito', 'pedidos');
UPDATE public.plans SET features = features || '{"recipes": true}'::jsonb
WHERE slug = 'gestion';
