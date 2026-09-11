-- Logout en todos los dispositivos: versión de tokens por usuario.
-- Al incrementar token_version se invalidan todos los JWT emitidos antes
-- (el claim `tv` del token debe coincidir con esta columna).
-- Seguro de correr en caliente: solo agrega columna con default (no toca filas).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 1;
