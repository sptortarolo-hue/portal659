-- Perfil de repartidor por comercio (v2: token único por repartidor + contraseña).
--
-- Modelo:
--  - El comercio crea un repartidor (nombre + teléfono) → fila vendor_staff con
--    invite_code único y status='pending' (sin cuenta todavía).
--  - El repartidor abre /vincular?code=XXX, elige una contraseña → se crea/vincula
--    un profile (identidad = teléfono), status='active', y el código se consume
--    (se limpia) porque funciona como token de primer acceso.
--  - Reingreso: teléfono + contraseña. Olvido: el comercio regenera el código.
--  - Se va: el comercio lo revoca (status='revoked' → pierde acceso).

-- Tabla (idempotente: existe desde la migración previa, se amplía acá).
CREATE TABLE IF NOT EXISTS public.vendor_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'delivery' CHECK (role IN ('owner', 'delivery')),
  invite_code text,
  phone text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (vendor_id, profile_id)
);

-- Ampliación por si la tabla previa ya fue aplicada sin estos campos.
ALTER TABLE public.vendor_staff ADD COLUMN IF NOT EXISTS invite_code text;
ALTER TABLE public.vendor_staff ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.vendor_staff ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

-- El repartidor puede existir antes de tener cuenta (profile_id null hasta claim).
ALTER TABLE public.vendor_staff ALTER COLUMN profile_id DROP NOT NULL;

-- Código único por repartidor (token).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_staff_invite ON public.vendor_staff(invite_code) WHERE invite_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_staff_profile ON public.vendor_staff(profile_id);
CREATE INDEX IF NOT EXISTS idx_vendor_staff_vendor ON public.vendor_staff(vendor_id);

-- Asignación de envíos (delivery multi-repartidor): profile del repartidor que
-- tomó el pedido (null = sin asignar, visible para todos los repartidores).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS claimed_at timestamptz;