import { NextResponse } from "next/server";
import { guardTvScreens } from "@/lib/tv-guard";
import { createScreen, hasUnpublishedDraft, listVendorScreens, loadCatalogSections } from "@/lib/tv-data";
import { normalizeTvConfig } from "@/lib/tv-config";

export const dynamic = "force-dynamic";

/**
 * ABM de pantallas TV del comercio.
 * GET  : lista (con el estado de conexión y si hay borrador sin publicar).
 * POST : crea una pantalla respetando `max_screens` del plan.
 */
export async function GET(request: Request) {
  const guard = await guardTvScreens(request);
  if (!guard.ok) return guard.response;

  const rows = await listVendorScreens(guard.ctx.vendorId);
  // Categorías reales del comercio: el editor las usa para elegir visibilidad
  // y orden (y así no se configuran nombres que ya no existen).
  const catalog = await loadCatalogSections(guard.ctx.vendorId).catch(() => ({ categoryNames: [] as string[], sections: [] }));
  const screens = rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    token: r.token,
    version: r.version,
    publishedAt: r.published_at,
    lastSeenAt: r.last_seen_at,
    clientVersion: r.client_version,
    createdAt: r.created_at,
    published: r.published ? true : false,
    unpublishedDraft: hasUnpublishedDraft(r),
    config: normalizeTvConfig(r.draft ?? {}),
  }));

  return NextResponse.json({
    screens,
    maxScreens: guard.ctx.maxScreens,
    categories: catalog.categoryNames || [],
  });
}

export async function POST(request: Request) {
  const guard = await guardTvScreens(request);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const kind = body?.kind === "orders" ? "orders" : "menu";
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "Pantalla";

  const total = (await listVendorScreens(guard.ctx.vendorId)).length;
  if (guard.ctx.maxScreens <= 0 || total >= guard.ctx.maxScreens) {
    return NextResponse.json(
      { error: `Tu plan incluye ${guard.ctx.maxScreens} pantalla(s). Pedí una extra escribiéndonos.` },
      { status: 403 }
    );
  }

  const row = await createScreen(guard.ctx.vendorId, name, kind);
  if (!row) {
    return NextResponse.json(
      { error: "Falta aplicar supabase/self-host/migrate-tv-screens.sql" },
      { status: 503 }
    );
  }

  return NextResponse.json({ screen: { id: row.id, name: row.name, token: row.token, kind: row.kind } });
}
