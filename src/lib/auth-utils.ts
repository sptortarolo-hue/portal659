import { getAuthUser, extractToken } from "./auth";
import { queryOne } from "./db";

export { extractToken };

/** Obtiene el id del usuario autenticado a partir del request. */
export async function getUserId(request: Request): Promise<string | null> {
  const user = await getAuthUser(request);
  return user?.id || null;
}

/** Verifica que un usuario sea admin (tabla vendors.is_admin). */
export async function isAdminUser(userId: string): Promise<boolean> {
  if (!userId) return false;
  const vendor = await queryOne<{ is_admin: boolean }>(
    `SELECT is_admin FROM vendors WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return vendor?.is_admin === true;
}