import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";

/**
 * Créditos de packs por clienta (teléfono).
 * - GET ?phone= : créditos de esa clienta (con nombre del pack).
 * - POST { action: "sell", pack_id, customer_phone }: vende un pack (suma
 *   sessions_total al saldo; se cobra por caja/MP aparte, acá solo se
 *   registra el saldo).
 * - POST { action: "use", customer_phone, pack_id? }: descuenta 1 sesión
 *   (del pack indicado o del primero con saldo).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") return NextResponse.json({ credits: [] });
  const { searchParams } = new URL(request.url);
  const phone = toE164(searchParams.get("phone") || "");
  if (!phone) return NextResponse.json({ credits: [] });
  try {
    const credits = await queryMany<Record<string, unknown>>(
      `SELECT c.id, c.remaining, c.customer_phone, p.id AS pack_id, p.name AS pack_name, p.sessions_total
       FROM service_pack_credits c
       JOIN service_packs p ON p.id = c.pack_id
       WHERE c.vendor_id = $1 AND c.customer_phone = $2
       ORDER BY c.created_at ASC`,
      [gate.vendor.id, phone]
    );
    return NextResponse.json({ credits: credits || [] });
  } catch {
    return NextResponse.json({ credits: [], migrationMissing: true }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const phone = toE164(String(body.customer_phone || ""));
  if (!phone) return NextResponse.json({ error: "Falta el teléfono de la clienta" }, { status: 400 });

  try {
    if (action === "sell") {
      const packId = String(body.pack_id || "");
      if (!packId) return NextResponse.json({ error: "Falta el pack" }, { status: 400 });
      const pack = await queryOne<{ id: string; sessions_total: number }>(
        `SELECT id, sessions_total FROM service_packs WHERE id = $1 AND vendor_id = $2 AND active = true LIMIT 1`,
        [packId, gate.vendor.id]
      );
      if (!pack) return NextResponse.json({ error: "Pack no encontrado" }, { status: 404 });
      const credit = await queryOne<Record<string, unknown>>(
        `INSERT INTO service_pack_credits (pack_id, vendor_id, customer_phone, remaining)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (pack_id, customer_phone) DO UPDATE SET remaining = service_pack_credits.remaining + EXCLUDED.remaining
         RETURNING *`,
        [pack.id, gate.vendor.id, phone, Math.max(1, Number(pack.sessions_total) || 1)]
      );
      return NextResponse.json({ credit });
    }

    if (action === "use") {
      const packId = typeof body.pack_id === "string" && body.pack_id ? body.pack_id : null;
      const params: unknown[] = [gate.vendor.id, phone];
      let extra = "";
      if (packId) {
        params.push(packId);
        extra = "AND c.pack_id = $3";
      }
      const credit = await queryOne<{ id: string; remaining: number }>(
        `SELECT c.id, c.remaining FROM service_pack_credits c
         WHERE c.vendor_id = $1 AND c.customer_phone = $2 AND c.remaining > 0 ${extra}
         ORDER BY c.created_at ASC LIMIT 1`,
        params
      );
      if (!credit) {
        return NextResponse.json({ error: "La clienta no tiene sesiones disponibles" }, { status: 404 });
      }
      const updated = await queryOne<Record<string, unknown>>(
        `UPDATE service_pack_credits SET remaining = remaining - 1 WHERE id = $1 RETURNING *`,
        [credit.id]
      );
      return NextResponse.json({ credit: updated });
    }

    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (e) {
    const msg = (e as Error)?.message || "";
    // Sin constraint único (migración vieja): fallback simple.
    if (/conflict|constraint|ON CONFLICT/i.test(msg)) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
      { status: 503 }
    );
  }
}
