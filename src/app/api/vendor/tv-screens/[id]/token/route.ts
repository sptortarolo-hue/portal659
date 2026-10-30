import { NextResponse } from "next/server";
import { guardTvScreens } from "@/lib/tv-guard";
import { listVendorScreens, rotateScreenToken } from "@/lib/tv-data";

export const dynamic = "force-dynamic";

/**
 * Rota el token de la pantalla: la URL vieja deja de servir al instante
 * (por si se compartió el link o se cambió la TV donde se muestra).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardTvScreens(request);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const row = (await listVendorScreens(guard.ctx.vendorId)).find((r) => r.id === id);
  if (!row) return NextResponse.json({ error: "Pantalla no encontrada" }, { status: 404 });

  const token = await rotateScreenToken(id, guard.ctx.vendorId);
  if (!token) {
    return NextResponse.json(
      { error: "Falta aplicar supabase/self-host/migrate-tv-screens.sql" },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, token });
}
