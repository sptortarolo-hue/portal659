import { NextResponse } from "next/server";
import { guardTvScreens } from "@/lib/tv-guard";
import { deleteScreen, listVendorScreens, updateScreenDraft } from "@/lib/tv-data";
import { normalizeTvConfig } from "@/lib/tv-config";

export const dynamic = "force-dynamic";

/**
 * Una pantalla: PATCH guarda el BORRADOR (la TV no se ve afectada hasta
 * "Publicar"), DELETE la elimina (y deja la pantalla del local con un 404).
 */
async function owned(id: string, vendorId: string) {
  const rows = await listVendorScreens(vendorId);
  return rows.find((r) => r.id === id) ?? null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardTvScreens(request);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const row = await owned(id, guard.ctx.vendorId);
  if (!row) return NextResponse.json({ error: "Pantalla no encontrada" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const config = normalizeTvConfig({
    ...(normalizeTvConfig(row.draft ?? {})),
    ...(body?.config && typeof body.config === "object" ? body.config : {}),
  });

  const done = await updateScreenDraft(id, guard.ctx.vendorId, config);
  if (!done) {
    return NextResponse.json(
      { error: "Falta aplicar supabase/self-host/migrate-tv-screens.sql" },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, config });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardTvScreens(_request);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const row = await owned(id, guard.ctx.vendorId);
  if (!row) return NextResponse.json({ error: "Pantalla no encontrada" }, { status: 404 });

  await deleteScreen(id, guard.ctx.vendorId);
  return NextResponse.json({ ok: true });
}
