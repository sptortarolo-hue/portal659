import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne } from "@/lib/db";

/**
 * POST /api/admin/bots/[id]/toggle — el kill switch del bot de un comercio,
 * desde el tablero del admin. Encender/apagar el bot en un minuto sin ir al
 * panel del comercio (tolerante a tabla sin migrar).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const params = await context.params;
  const row = await queryOne<{ enabled: boolean }>(
    `UPDATE vendor_wa_bots SET enabled = NOT COALESCE(enabled, true), updated_at = now()
     WHERE vendor_id = $1
     RETURNING enabled`,
    [params.id]
  ).catch(() => null);

  if (!row) {
    return NextResponse.json({ error: "El comercio no tiene bot configurado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, enabled: row.enabled });
}
