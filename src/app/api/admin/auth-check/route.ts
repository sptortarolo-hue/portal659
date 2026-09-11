import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";

/**
 * Chequeo liviano de permiso admin para el AdminGuard.
 * No corre queries pesadas: solo JWT + profiles.is_admin.
 */
export async function GET(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Error al verificar permisos" }, { status: 500 });
  }
}
