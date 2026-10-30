import { NextResponse } from "next/server";
import { guardTvScreens } from "@/lib/tv-guard";
import { listVendorScreens, publishScreen } from "@/lib/tv-data";

export const dynamic = "force-dynamic";

/**
 * Publica el borrador: la pantalla del local se entera por el SSE y recarga.
 * Versionar en el servidor (y no en el cliente) evita que dos navegadores
 * abran con versiones distintas.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardTvScreens(request);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const row = (await listVendorScreens(guard.ctx.vendorId)).find((r) => r.id === id);
  if (!row) return NextResponse.json({ error: "Pantalla no encontrada" }, { status: 404 });

  const published = await publishScreen(id, guard.ctx.vendorId);
  if (!published) {
    return NextResponse.json(
      { error: "Falta aplicar supabase/self-host/migrate-tv-screens.sql" },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, version: published.version, publishedAt: published.published_at });
}
