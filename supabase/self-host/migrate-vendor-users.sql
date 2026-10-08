-- Usuarios del local (2 niveles por comercio): nombre + nivel + contraseña.
--
-- Modelo:
--  - El dueño crea usuarios en Configuración → Equipo (nombre visible,
--    nombre de usuario corto, nivel, contraseña) → fila vendor_staff con
--    role='staff', staff_level ('admin' = Encargado, 'empleado' = Empleado),
--    username único por comercio y status='active'.
--  - La identidad vive en profiles (email sintético
--    equipo_<vendor>__<username>@staff.portal659.local, invisible en la UI);
--    la contraseña se guarda hasheada (argon2) en profiles.password_hash,
--    igual que el resto de los logins. El username vive en vendor_staff.
--  - Login: POST /api/auth/staff/login {store, username, password} (usuario
--    simple, sin email). Revocar: status='revoked' + bump de token_version
--    (mata la sesión).
--  - Niveles: 'admin' (Encargado: opera + edita config del local, sin
--    usuarios/plata/fiscal) y 'empleado' (opera: pedidos, mostrador, mesas,
--    caja con cierre Z, impresión; sin config).
--  - Repartidores existentes (role='delivery', username NULL) no se tocan.
--
-- Idempotente y tolerante: el código funciona sin esta migración aplicada
-- (los endpoints responden 503 amable / ignoran usuarios).

-- Columnas nuevas.
ALTER TABLE public.vendor_staff ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.vendor_staff ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.vendor_staff ADD COLUMN IF NOT EXISTS staff_level text NOT NULL DEFAULT 'empleado';

-- Ampliar el CHECK de role para admitir 'staff' (usuarios del local).
-- Robusto al nombre del constraint (puede variar según cómo se creó la tabla):
-- se dropean todos los CHECK sobre vendor_staff que mencionen el role.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.vendor_staff'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%IN%owner%delivery%'
  LOOP
    EXECUTE format('ALTER TABLE public.vendor_staff DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.vendor_staff DROP CONSTRAINT IF EXISTS vendor_staff_role_check;
  ALTER TABLE public.vendor_staff
    ADD CONSTRAINT vendor_staff_role_check CHECK (role IN ('owner', 'delivery', 'staff'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- Niveles válidos del usuario del local.
DO $$
BEGIN
  ALTER TABLE public.vendor_staff DROP CONSTRAINT IF EXISTS vendor_staff_level_check;
  ALTER TABLE public.vendor_staff
    ADD CONSTRAINT vendor_staff_level_check CHECK (staff_level IN ('admin', 'empleado'));
EXCEPTION WHEN others THEN NULL;
END $$;

-- Usuario único por comercio (case-insensitive; solo filas de usuarios).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_staff_username
  ON public.vendor_staff (vendor_id, lower(username)) WHERE username IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_staff_username ON public.vendor_staff(username) WHERE username IS NOT NULL;
