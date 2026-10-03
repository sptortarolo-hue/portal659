import { queryMany } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

/**
 * Saldo de packs de una clienta (público, para "reservar con pack").
 * GET /api/pack-credits?vendorId=&phone= → [{ pack_id, pack_name, remaining }]
 * Solo muestra packs con saldo > 0. Rate-limit 10/min.
 */
export const GET = withRateLimit(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const vendorId = searchParams.get("vendorId") || "";
  const phone = toE164(searchParams.get("phone") || "");
  if (!/^[0-9a-f-]{36}$/i.test(vendorId) || !phone) {
    return NextResponse.json({ credits: [] });
  }
  try {
    const credits = await queryMany<{ pack_id: string; pack_name: string; remaining: number }>(
      `SELECT c.pack_id::text AS pack_id, p.name AS pack_name, c.remaining
       FROM service_pack_credits c
       JOIN service_packs p ON p.id = c.pack_id
       WHERE c.vendor_id = $1 AND c.customer_phone = $2 AND c.remaining > 0
       ORDER BY c.created_at ASC`,
      [vendorId, phone]
    );
    return NextResponse.json({
      credits: (credits || []).map((c) => ({
        pack_id: String(c.pack_id),
        pack_name: String(c.pack_name ?? ""),
        remaining: Number(c.remaining) || 0,
      })),
    });
  } catch {
    return NextResponse.json({ credits: [] });
  }
}, { maxRequests: 20 });
