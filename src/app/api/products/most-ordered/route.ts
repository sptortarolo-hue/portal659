import { NextResponse } from "next/server";
import { queryMany } from "@/lib/db";
import { getZoneSlugs } from "@/lib/zone";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "7", 10);
  const limit = parseInt(searchParams.get("limit") || "5", 10);
  const neighborhoods = await getZoneSlugs();

  const items = await queryMany(
    `SELECT * FROM get_most_ordered_products($1, $2, $3)`,
    [days, limit, neighborhoods]
  );

  // Defensa sin migración: líneas manuales de mostrador ("Varios", ids
  // "manual:...") y basura histórica nunca llegan a la sección, aunque la
  // función SQL todavía sea la versión vieja.
  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const clean = ((items || []) as any[]).filter(
    (it) => typeof it?.product_id === "string" && UUID_RE.test(it.product_id) && (it as any).manual !== true
  );

  // La RPC no devuelve imagen: la resolvemos con una query puntual sobre
  // products, sin migraciones ni cambios de esquema. Best-effort.
  const byId: Record<string, { image_url: string | null; category: string | null }> = {};
  if (clean.length > 0) {
    try {
      const rows = await queryMany<{ id: string; image_url: string | null; category: string | null }>(
        `SELECT id, image_url, category FROM products WHERE id = ANY($1)`,
        [clean.map((it: any) => it.product_id)]
      );
      for (const r of rows || []) byId[r.id] = { image_url: r.image_url ?? null, category: r.category ?? null };
    } catch {
      // sin imagen: el cliente renderiza el fallback
    }
  }

  const enrichedItems = clean.map((it: any) => ({
    ...it,
    image_url: byId[it.product_id]?.image_url ?? null,
    category: byId[it.product_id]?.category ?? null,
  }));

  return NextResponse.json({ items: enrichedItems });
}