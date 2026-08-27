import { getAuthUser } from "./auth";

export async function isAdmin(request: Request): Promise<boolean> {
  const user = await getAuthUser(request);
  return user?.is_admin === true;
}

export async function requireAdmin(request: Request) {
  if (!(await isAdmin(request))) {
    throw new Error("No autorizado");
  }
}