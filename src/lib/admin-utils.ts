import { getAuthUser } from "./auth";
import { queryOne } from "./db";

export async function isAdmin(request: Request): Promise<boolean> {
  const user = await getAuthUser(request);
  if (!user) return false;
  const vendor = await queryOne<{ is_admin: boolean }>(
    `SELECT is_admin FROM vendors WHERE user_id = $1 LIMIT 1`,
    [user.id]
  );
  return vendor?.is_admin === true;
}

export async function requireAdmin(request: Request) {
  if (!(await isAdmin(request))) {
    throw new Error("No autorizado");
  }
}