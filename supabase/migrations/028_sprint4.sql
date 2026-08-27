-- 028: Sprint 4 — Info del barrio (Alerta Vecinal), respuestas a reseñas y destacados
-- ============================================================

-- ============================================================
-- 1. info_items (Alerta Vecinal: transporte, utilidades, horarios, avisos)
-- Contenido curado por el equipo; lectura pública.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.info_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('transporte', 'utilidades', 'horarios', 'noticias')),
  title text NOT NULL,
  body text,
  tags text[],
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, title)
);

ALTER TABLE public.info_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read info items" ON public.info_items;
CREATE POLICY "Public read info items"
  ON public.info_items FOR SELECT
  USING (active = true);

-- Seed inicial (curado, reemplazable desde el SQL editor)
INSERT INTO public.info_items (category, title, body, tags, sort) VALUES
  ('transporte', 'Línea Este al centro',
   'Conecta Sicardi y Garibaldi con el centro de La Plata pasando por la Avenida 659. Frecuencia habitual de 15-20 minutos en hora pico. Pagá con SUBE.',
   ARRAY['colectivos', 'linea este'], 10),
  ('transporte', 'Sube sin saldo en la boca',
   'Si te quedás sin saldo y no llegás a una boca de SUBE, consultá a tu chofer: las máquinas de muchos ramales cargan en efectivo en el mismo colectivo.',
   ARRAY['sube', 'colectivos'], 11),
  ('utilidades', 'Emergencias — números útiles',
   '911 Emergencias y Policía · 100 Bomberos · 107 SAME (ambulancia) · 103 Defensa Civil · 102 línea de niñas, niños y adolescentes. Guardalos en tu celular.',
   ARRAY['emergencias', 'telefonos'], 20),
  ('utilidades', 'Policía Local de la zona',
   'Para trámites y consultas barriales, la comisaría más cercana atiende reclamos y denuncias. Ante riesgo de vida o delito en curso, llamá siempre al 911.',
   ARRAY['policia', 'seguridad'], 21),
  ('horarios', 'Farmacias de turno',
   'Las farmacias del barrio rotan el turno nocturno. Consultá el cartel del local más cercano o buscá "farmacias de turno La Plata" en tu buscador.',
   ARRAY['farmacias', 'horarios'], 30),
  ('horarios', 'Comercios del barrio',
   'Cada comercio publica su horario y ofertas en su micrositio de Portal 659. Buscalo por rubro y consultá directo por WhatsApp antes de ir.',
   ARRAY['comercios', 'horarios'], 31),
  ('noticias', '¡Bienvenida la Alerta Vecinal!',
   'Este es el boletín del barrio de Portal 659: transporte, utilidades, horarios y avisos de Sicardi y Garibaldi. ¿Tenés un dato útil? Avísanos.',
   ARRAY['bienvenida', 'aviso'], 40)
ON CONFLICT (category, title) DO UPDATE SET
  body = EXCLUDED.body,
  tags = EXCLUDED.tags,
  sort = EXCLUDED.sort,
  active = EXCLUDED.active,
  updated_at = now();

-- ============================================================
-- 2. reviews: respuesta del comercio a la reseña
-- ============================================================
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reply text;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reply_by text;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS replied_at timestamptz;

-- ============================================================
-- 3. vendors.featured (Destacados del barrio — controlado por admin)
-- ============================================================
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;