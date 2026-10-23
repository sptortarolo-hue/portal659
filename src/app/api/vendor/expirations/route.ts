import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { expiryStatus, toDateOnly } from "@/lib/expiry";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GATE_MSG = "Compras e inventario forman parte del plan Gestión integral";

type ExpiryItem = {
  id: string;
  name: string;
  category: string | null;
  stock: number | null;
  available: boolean;
  supplier_id: string | null;
  supplier_name: string | null;
  expires_at: string;
  days_left: number | null;
  status: "expired" | "soon" | "ok";
};

/** Vencimientos de mercadería del comercio (alerta global configurable). */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("inventory")) {
    return NextResponse.json({ error: GATE_MSG }, { status: 403 });
  }

  const rawThreshold = Number((gate.vendor as { expiry_alert_days?: number | null }).expiry_alert_days);
  const threshold = Number.isFinite(rawThreshold)
    ? Math.min(365, Math.max(0, Math.floor(rawThreshold)))
    : 7;

  const cols = await queryMany<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'products' AND column_name IN ('expires_at', 'supplier_id')`
  ).catch(() => []);
  const colSet = new Set((cols || []).map((c) => c.column_name));
  if (!colSet.has("expires_at")) {
    return NextResponse.json({
      items: [],
      counts: { expired: 0, soon: 0, ok: 0 },
      threshold,
      migration_pending: true,
    });
  }

  const hasSupplier = colSet.has("supplier_id");
  const rows = await queryMany<Record<string, unknown>>(
    `SELECT p.id, p.name, p.category, p.stock, p.available,
            p.expires_at::text AS expires_at,
            ${hasSupplier ? "p.supplier_id, s.name AS supplier_name" : "NULL::uuid AS supplier_id, NULL::text AS supplier_name"}
     FROM products p
     ${hasSupplier ? "LEFT JOIN suppliers s ON s.id = p.supplier_id" : ""}
     WHERE p.vendor_id = $1 AND p.expires_at IS NOT NULL
     ORDER BY p.expires_at ASC, p.name ASC`,
    [gate.vendor.id]
  ).catch(() => []);

  const items: ExpiryItem[] = [];
  for (const row of rows || []) {
    const expiresAt = toDateOnly(row.expires_at);
    if (!expiresAt) continue;
    const info = expiryStatus(expiresAt, threshold);
    if (info.status === "none") continue;
    items.push({
      id: String(row.id),
      name: String(row.name || ""),
      category: row.category != null ? String(row.category) : null,
      stock: row.stock != null ? Number(row.stock) : null,
      available: row.available !== false,
      supplier_id: row.supplier_id != null ? String(row.supplier_id) : null,
      supplier_name: row.supplier_name != null ? String(row.supplier_name) : null,
      expires_at: expiresAt,
      days_left: info.days,
      status: info.status,
    });
  }

  const counts = {
    expired: items.filter((i) => i.status === "expired").length,
    soon: items.filter((i) => i.status === "soon").length,
    ok: items.filter((i) => i.status === "ok").length,
  };

  return NextResponse.json({ items, counts, threshold, migration_pending: false });
}
