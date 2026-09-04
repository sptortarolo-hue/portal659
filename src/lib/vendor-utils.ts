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

export type StaffRole = "owner" | "delivery" | null;

/**
 * Obtiene el vendor (comercio) del usuario autenticado.
 * - Owner: vendors.user_id = user.id.
 * - Staff: vendor_staff.profile_id = user.id (repartidor / delivery).
 * - Admin con `portal659-admin-as`: resuelve por id (modo llave en mano).
 * Devuelve también `staffRole` (null si es dueño, "delivery" si es repartidor).
 */
export async function getVendorByRequest(request: Request): Promise<{
  userId: string | null;
  vendor: { id: string; user_id: string | null } | null;
  staffRole: StaffRole;
}> {
  const user = await getAuthUser(request);
  if (!user) return { userId: null, vendor: null, staffRole: null };

  const asVendorId = getCookie(request, ADMIN_AS_COOKIE);
  if (asVendorId && user.is_admin) {
    const vendor = await queryOne<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM vendors WHERE id = $1 LIMIT 1`,
      [asVendorId]
    );
    return { userId: user.id, vendor: vendor ?? null, staffRole: null };
  }

  const vendor = await queryOne<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM vendors WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );
  if (vendor) return { userId: user.id, vendor, staffRole: null };

  // No es dueño: ¿es repartidor vinculado por código y activo?
  const staff = await queryOne<{ vendor_id: string; role: string }>(
    `SELECT vendor_id, role FROM vendor_staff WHERE profile_id = $1 AND status = 'active' LIMIT 1`,
    [user.id]
  );
  if (staff) {
    const sv = await queryOne<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM vendors WHERE id = $1 LIMIT 1`,
      [staff.vendor_id]
    );
    return {
      userId: user.id,
      vendor: sv ?? null,
      staffRole: staff.role === "delivery" ? ("delivery" as const) : ("owner" as const),
    };
  }

  return { userId: user.id, vendor: null, staffRole: null };
}