-- ============================================================
-- Login con Google (OAuth 2.0 / OpenID Connect) — Portal 659
-- ============================================================
-- Agrega el vínculo entre una cuenta de Google y el perfil local.
-- La sesión SIGUE siendo el JWT propio (src/lib/auth.ts): Google solo
-- prueba la identidad del email y devuelve un `sub` estable; los
-- cookies sb-access-token/sb-refresh-token se emiten igual que con
-- contraseña.
--
-- Modelo:
--  - google_sub : claim `sub` de Google (ID estable de la cuenta).
--                 NULL = perfil sin vincular.
--  - Las cuentas creadas solo con Google quedan con password_hash = ''
--    (el login por contraseña ya rechaza un hash vacío y muestra
--    "Esta cuenta usa Google").
--  - El alta de comercio y el equipo del local NO usan Google: el
--    equipo entra con usuario + contraseña por local (email sintético
--    @staff.portal659.local, que nunca matchea un email real).
--
-- Idempotente. Sin esta migración el callback de Google responde 503
-- nombrando este archivo; el resto del sitio funciona igual.
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_sub text;

-- Un mismo perfil por cuenta de Google. Parcial: los perfiles sin
-- vincular (google_sub NULL) no compiten por el índice.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_google_sub_key
  ON public.profiles (google_sub)
  WHERE google_sub IS NOT NULL;

COMMENT ON COLUMN public.profiles.google_sub IS
  'Claim sub de Google (login con Google). NULL = cuenta sin vincular.';
