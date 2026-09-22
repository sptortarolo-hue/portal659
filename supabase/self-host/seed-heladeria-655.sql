-- ============================================================================
-- SEED ÚNICO: Heladería 655 — 5 productos + grupo "Gustos" (60 sabores).
-- ----------------------------------------------------------------------------
-- NO es una migración: es carga de datos de UN comercio. Se corre UNA vez y
-- tiene guardia anti-duplicados (si ya existe, avisa y no hace nada).
--
-- Requiere que existan las migraciones (si alguna falta, igual carga con
-- defaults: grupo con el máximo más permisivo y sin overrides por tamaño):
--   migrate-min-selections.sql  (modifier_groups.min_selections)
--   migrate-link-overrides.sql  (product_modifier_links.max/min_selections)
--   migrate-requires-prep.sql   (products.requires_prep)
--
-- Productos en precio 0 e INACTIVOS: no se ven en el micrositio hasta que el
-- comercio cargue precios y los active en Panel → Menú → Productos.
--
-- Correr en el VPS (el archivo vive en el HOST, ej. /opt/portal659):
--   docker exec -i portal659-db psql -U portal659 -d portal659 \
--     < /opt/portal659/supabase/self-host/seed-heladeria-655.sql
-- ============================================================================

DO $$
DECLARE
  v_vendor_id uuid;
  v_vertical text;
  v_has_requires_prep boolean := false;
  v_has_grp_min boolean := false;
  v_has_link_mm boolean := false;
  v_gid uuid;
  v_pid_cuarto uuid;
  v_pid_medio uuid;
  v_pid_kilo uuid;
  v_pid_cuc2 uuid;
  v_pid_cuc3 uuid;
  v_opts jsonb := $json$[
    {"label":"Multisabor","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Americana","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Americana con Frutillas","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Banana Dolca","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Banana Split","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Crema Oreo","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Crema Rusa","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Crema del Cielo","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Crema Flan","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Crema del Cielo","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Crema Flan","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Coco Split","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Frutilla a la Crema","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Frutilla Stracciatella","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Frutilla Cadbury","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Frutos Patagónicos","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Mascarpone con Frutos Rojos","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Cereza a la Crema","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Limón a la Crema","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Menta Granizada","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Mantecol","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Mousse de Maracuyá","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Granizado","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Pistacho Tana","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Beyli's","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Bon o Bon Split","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Tiramisú","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Tramontana","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Vainilla","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Sambayón","price_mod":0,"category":"Clásicos y frutales"},
    {"label":"Dulce de Leche","price_mod":0,"category":"Dulce de leche"},
    {"label":"Dulce de Leche con Nuez","price_mod":0,"category":"Dulce de leche"},
    {"label":"Dulce de Leche Granizado","price_mod":0,"category":"Dulce de leche"},
    {"label":"Dulce de Leche Oreo","price_mod":0,"category":"Dulce de leche"},
    {"label":"Súper Dulce de Leche","price_mod":0,"category":"Dulce de leche"},
    {"label":"Dulce de Leche Bomba Split","price_mod":0,"category":"Dulce de leche"},
    {"label":"Dulce de Leche Havanna","price_mod":0,"category":"Dulce de leche"},
    {"label":"Dulce de Leche Tentación","price_mod":0,"category":"Dulce de leche"},
    {"label":"Chocolate","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Amargo","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Mousse Milka","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate con Almendras","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Marroc","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Blanco","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Bomba Split","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Italiano con Pasas","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Shot","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Ferrero","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Blanco Toffi","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Blanco Kinder","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Dubai","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Bomba Split","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Pasión","price_mod":0,"category":"Chocolates"},
    {"label":"Chocolate Tentación","price_mod":0,"category":"Chocolates"},
    {"label":"Frutilla","price_mod":0,"category":"Sabores al agua"},
    {"label":"Ananá","price_mod":0,"category":"Sabores al agua"},
    {"label":"Durazno","price_mod":0,"category":"Sabores al agua"},
    {"label":"Limón","price_mod":0,"category":"Sabores al agua"},
    {"label":"Limón a la Reina","price_mod":0,"category":"Sabores al agua"},
    {"label":"Frutos Rojos","price_mod":0,"category":"Sabores al agua"}
  ]$json$;
BEGIN
  -- 1) Ubicar al comercio.
  SELECT id, vertical INTO v_vendor_id, v_vertical
  FROM public.vendors WHERE slug = 'heladeria-655' LIMIT 1;
  IF v_vendor_id IS NULL THEN
    RAISE EXCEPTION 'seed-heladeria-655: no existe un comercio con slug heladeria-655';
  END IF;
  IF v_vertical IS DISTINCT FROM 'gastronomia' THEN
    RAISE EXCEPTION 'seed-heladeria-655: el comercio % no es gastronomía (vertical=%)', 'heladeria-655', v_vertical;
  END IF;

  -- 2) Guardia anti-duplicados.
  IF EXISTS (SELECT 1 FROM public.modifier_groups WHERE vendor_id = v_vendor_id AND group_name ILIKE 'gustos') THEN
    RAISE NOTICE 'seed-heladeria-655: ya existe el grupo Gustos, no se hace nada.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE vendor_id = v_vendor_id AND (name ILIKE 'helado %' OR name ILIKE 'cucurucho %')) THEN
    RAISE NOTICE 'seed-heladeria-655: ya existen productos de helado, no se hace nada.';
    RETURN;
  END IF;

  -- 3) Detectar columnas opcionales (migraciones pendientes).
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'requires_prep')
    INTO v_has_requires_prep;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modifier_groups' AND column_name = 'min_selections')
    INTO v_has_grp_min;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'product_modifier_links' AND column_name = 'max_selections')
    INTO v_has_link_mm;

  -- 4) Productos (precio 0, INACTIVOS hasta que carguen precios).
  IF v_has_requires_prep THEN
    INSERT INTO public.products (vendor_id, name, price, category, type, available, requires_prep)
    VALUES (v_vendor_id, 'Helado 1/4 kg', 0, 'Helados', 'food', false, false) RETURNING id INTO v_pid_cuarto;
    INSERT INTO public.products (vendor_id, name, price, category, type, available, requires_prep)
    VALUES (v_vendor_id, 'Helado 1/2 kg', 0, 'Helados', 'food', false, false) RETURNING id INTO v_pid_medio;
    INSERT INTO public.products (vendor_id, name, price, category, type, available, requires_prep)
    VALUES (v_vendor_id, 'Helado 1 kg', 0, 'Helados', 'food', false, false) RETURNING id INTO v_pid_kilo;
    INSERT INTO public.products (vendor_id, name, price, category, type, available, requires_prep)
    VALUES (v_vendor_id, 'Cucurucho 2 bochas', 0, 'Helados', 'food', false, false) RETURNING id INTO v_pid_cuc2;
    INSERT INTO public.products (vendor_id, name, price, category, type, available, requires_prep)
    VALUES (v_vendor_id, 'Cucurucho 3 bochas', 0, 'Helados', 'food', false, false) RETURNING id INTO v_pid_cuc3;
  ELSE
    INSERT INTO public.products (vendor_id, name, price, category, type, available)
    VALUES (v_vendor_id, 'Helado 1/4 kg', 0, 'Helados', 'food', false) RETURNING id INTO v_pid_cuarto;
    INSERT INTO public.products (vendor_id, name, price, category, type, available)
    VALUES (v_vendor_id, 'Helado 1/2 kg', 0, 'Helados', 'food', false) RETURNING id INTO v_pid_medio;
    INSERT INTO public.products (vendor_id, name, price, category, type, available)
    VALUES (v_vendor_id, 'Helado 1 kg', 0, 'Helados', 'food', false) RETURNING id INTO v_pid_kilo;
    INSERT INTO public.products (vendor_id, name, price, category, type, available)
    VALUES (v_vendor_id, 'Cucurucho 2 bochas', 0, 'Helados', 'food', false) RETURNING id INTO v_pid_cuc2;
    INSERT INTO public.products (vendor_id, name, price, category, type, available)
    VALUES (v_vendor_id, 'Cucurucho 3 bochas', 0, 'Helados', 'food', false) RETURNING id INTO v_pid_cuc3;
  END IF;

  -- 5) Grupo "Gustos" (default = el más permisivo; cada link lleva su override).
  IF v_has_grp_min THEN
    INSERT INTO public.modifier_groups (vendor_id, group_name, options, required, max_selections, min_selections, is_variant)
    VALUES (v_vendor_id, 'Gustos', v_opts, true, 5, 1, true) RETURNING id INTO v_gid;
  ELSE
    INSERT INTO public.modifier_groups (vendor_id, group_name, options, required, max_selections, is_variant)
    VALUES (v_vendor_id, 'Gustos', v_opts, true, 5, true) RETURNING id INTO v_gid;
  END IF;

  -- 6) Links con override por tamaño (1/4→2, 1/2→3, 1kg→5, cuc2→2, cuc3→3; mín 1).
  IF v_has_link_mm THEN
    INSERT INTO public.product_modifier_links (group_id, product_id, position, max_selections, min_selections) VALUES
      (v_gid, v_pid_cuarto, 0, 2, 1),
      (v_gid, v_pid_medio, 1, 3, 1),
      (v_gid, v_pid_kilo, 2, 5, 1),
      (v_gid, v_pid_cuc2, 3, 2, 1),
      (v_gid, v_pid_cuc3, 4, 3, 1);
  ELSE
    INSERT INTO public.product_modifier_links (group_id, product_id, position) VALUES
      (v_gid, v_pid_cuarto, 0),
      (v_gid, v_pid_medio, 1),
      (v_gid, v_pid_kilo, 2),
      (v_gid, v_pid_cuc2, 3),
      (v_gid, v_pid_cuc3, 4);
  END IF;

  RAISE NOTICE 'seed-heladeria-655: OK — 5 productos (inactivos, precio 0) + grupo Gustos con 60 sabores.';
END $$;
