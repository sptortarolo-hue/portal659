import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne } from "@/lib/db";
import { AR_DAY_SQL } from "@/lib/analytics-day";

export const dynamic = "force-dynamic";

async function hasTable(table: string): Promise<boolean> {
  try {
    const r = await queryOne<{ ok: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS ok`,
      [`public.${table}`]
    );
    return r?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Tráfico e interacción del portal (30d): vistas únicas por día, top de
 * páginas, búsquedas más frecuentes y clicks de WhatsApp / apertura de
 * micrositios. Todo tolerant: sin tablas (migración pendiente) devuelve
 * estructura vacía en ceros, la UI muestra "sin datos".
 */
export async function GET(request: Request) {
  try {
    if (!(await isAdmin(request))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    if (!(await hasTable("portal_page_views"))) {
      return NextResponse.json({ ready: false, daily: [], topPaths: [], topSearches: [], waTotal: 0, storeOpenTotal: 0, waByVendor: [] });
    }
    const [daily, topPaths, topSearches, totals, waByVendorRaw] = await Promise.all([
      queryMany<Record<string, unknown>>(
        `SELECT to_char(ds.day, 'YYYY-MM-DD') AS day,
                count(pv.id) AS views,
                count(DISTINCT pv.device_id) AS visitors
           FROM generate_series(${AR_DAY_SQL} - 29, ${AR_DAY_SQL}, interval '1 day') AS ds(day)
           LEFT JOIN portal_page_views pv ON pv.day = ds.day::date
          GROUP BY ds.day ORDER BY ds.day`,
        []
      ),
      queryMany<Record<string, unknown>>(
        `SELECT path, count(*) AS views, count(DISTINCT device_id) AS uniques
           FROM portal_page_views
          WHERE day >= ${AR_DAY_SQL} - 29
          GROUP BY path ORDER BY views DESC LIMIT 12`
      ),
      queryMany<Record<string, unknown>>(
        `SELECT COALESCE(value, '(sin término)') AS value, count(*) AS n
           FROM portal_events
          WHERE kind = 'search' AND day >= ${AR_DAY_SQL} - 29
          GROUP BY value ORDER BY n DESC LIMIT 12`
      ),
      queryMany<Record<string, unknown>>(
        `SELECT count(*) FILTER (WHERE kind = 'wa_click') AS wa_clicks,
                count(*) FILTER (WHERE kind = 'store_open') AS store_opens
           FROM portal_events WHERE day >= ${AR_DAY_SQL} - 29`
      ),
      queryMany<Record<string, unknown>>(
        `SELECT v.store_name, count(*) AS n
           FROM portal_events e
           JOIN vendors v ON v.id = e.vendor_id
          WHERE e.kind = 'wa_click' AND e.day >= ${AR_DAY_SQL} - 29
          GROUP BY v.store_name ORDER BY n DESC LIMIT 8`
      ),
    ]);

    const t = (totals[0] || {}) as Record<string, unknown>;
    return NextResponse.json({
      ready: true,
      daily: (daily as any[]).map((r) => ({
        day: String(r.day ?? "").slice(0, 10),
        views: Number(r.views ?? 0),
        visitors: Number(r.visitors ?? 0),
      })),
      topPaths: (topPaths as any[]).map((r) => ({
        path: String(r.path ?? "/"),
        views: Number(r.views ?? 0),
        uniques: Number(r.uniques ?? 0),
      })),
      topSearches: (topSearches as any[]).map((r) => ({
        value: String(r.value ?? ""),
        n: Number(r.n ?? 0),
      })),
      waTotal: Number(t.wa_clicks ?? 0),
      storeOpenTotal: Number(t.store_opens ?? 0),
      waByVendor: (waByVendorRaw as any[]).map((r) => ({
        store_name: String(r.store_name ?? ""),
        n: Number(r.n ?? 0),
      })),
    });
  } catch (e) {
    console.error("[api/admin/traffic] error:", e);
    return NextResponse.json({ error: "No se pudo cargar el tráfico" }, { status: 500 });
  }
}
