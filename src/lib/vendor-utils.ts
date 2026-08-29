import { getAuthUser } from "./auth";
import { queryOne } from "./db";

const ADMIN_AS_COOKIE = "portal659-admin-as";

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=").trim();
  }
  return null;
}

export { ADMIN_AS_COOKIE };

/**
 * Obtiene el vendor (comercio) del usuario autenticado.
 * Si el usuario es admin y existe el override `portal659-admin-as`,
 * resuelve el vendor por id (modo llave en mano / impersonación),
 * permitiendo cargar un comercio que todavía no tiene dueño.
 */
export async function getVendorByRequest(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return { userId: null as string | null, vendor: null };

  const asVendorId = getCookie(request, ADMIN_AS_COOKIE);
  if (asVendorId && user.is_admin) {
    const vendor = await queryOne<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM vendors WHERE id = $1 LIMIT 1`,
      [asVendorId]
    );
    return { userId: user.id, vendor };
  }

  const vendor = await queryOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM vendors WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );
  return { userId: user.id, vendor };
}