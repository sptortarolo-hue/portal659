import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne, query } from "@/lib/db";

/**
 * GET /api/admin/bots/agents — agentes del Bot Studio (uno por comercio + el central).
 * Admin only. Merge con el estado vivo del cerebro (GET wabot/bots).
 */
export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const rows = await queryMany<{
    key: string;
    vendor_id: string | null;
    name: string;
    mode: string;
    enabled: boolean;
    tone: string;
    greeting: string | null;
    handoff_phone: string | null;
    store_name: string | null;
    slug: string | null;
  }>(
    `SELECT b.key, b.vendor_id, b.name, b.mode, b.enabled, b.tone, b.greeting, b.handoff_phone,
            v.store_name, v.slug
     FROM bot_agents b
     LEFT JOIN vendors v ON v.id = b.vendor_id
     ORDER BY (b.key = 'portal') DESC, v.store_name ASC NULLS FIRST`
  ).catch(() => []);

  const liveByVendor = new Map<string, any>();
  const wabotUrl = (process.env.WABOT_URL || "http://portal659-wabot:8792").replace(/\/$/, "");
  try {
    const r = await fetch(`${wabotUrl}/bots`, {
      headers: { Authorization: `Bearer ${process.env.WA_BOT_SECRET || ""}` },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const live = await r.json();
      for (const v of live?.vendors || []) liveByVendor.set(String(v.vendorId), v);
    }
  } catch { /* cerebro caído: mostramos igual la config */ }

  return NextResponse.json({
    agents: (rows || []).map((a) => {
      const lv = a.vendor_id ? liveByVendor.get(String(a.vendor_id)) : null;
      return {
        ...a,
        connected: lv?.connected === true,
        lastSeen: lv?.lastSeen ?? null,
        messagesDay: lv?.inboundDay ?? 0,
        handoffsDay: lv?.handoffsDay ?? 0,
      };
    }),
  });
}

/** POST /api/admin/bots/agents — crear agente para un comercio sin fila. */
export async function POST(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const vendorId = String(body.vendorId || "");
  if (!vendorId) return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });
  const v = await queryOne<{ id: string; store_name: string }>(
    `SELECT id, store_name FROM vendors WHERE id = $1 LIMIT 1`, [vendorId]
  ).catch(() => null);
  if (!v) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  await query(
    `INSERT INTO bot_agents (key, vendor_id, name, mode, enabled)
     VALUES ($1, $2, $3, 'concierge', false)
     ON CONFLICT (key) DO NOTHING`,
    [vendorId, vendorId, v.store_name]
  );
  return NextResponse.json({ ok: true, key: vendorId });
}
