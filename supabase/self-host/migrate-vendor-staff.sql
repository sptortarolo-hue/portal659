-- Perfil de repartidor por comercio (vinculación por código).
-- El comercio genera un código (vendors.link_code); el repartidor lo ingresa
-- desde la app y queda vinculado como vendor_staff.role='delivery'. Al entrar
-- al dashboard ve solo el módulo Delivery (pedidos listos/enviados + Entregado).

CREATE TABLE IF NOT EXISTS public.vendor_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'delivery' CHECK (role IN ('owner', 'delivery')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (vendor_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_vendor_staff_profile ON public.vendor_staff(profile_id);
CREATE INDEX IF NOT EXISTS idx_vendor_staff_vendor ON public.vendor_staff(vendor_id);

-- Código de vinculación del comercio (el repartidor lo ingresa para unirse).
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS link_code text;

-- Asignación de envíos: id del profile del repartidor que tomó el pedido
-- (null = sin asignar, visible para todos los repartidores del comercio).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS claimed_at timestamptz;