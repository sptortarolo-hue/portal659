import { getAuthUser } from "./auth";
import { queryOne } from "./db";

/** Obtiene el vendor (comercio) del usuario autenticado. */
export async function getVendorByRequest(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return { userId: null as string | null, vendor: null };
  const vendor = await queryOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM vendors WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );
  return { userId: user.id, vendor };
}