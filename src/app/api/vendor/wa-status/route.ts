import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { isDaytimeAR, sendWaText } from "@/lib/wa-send";
import { NextResponse } from "next/server";

/**
 * Estado y toggle de recordatorios por WhatsApp del comercio.
 * - GET → { waReminders, linked, waPhone }
 *   (linked = relay Portal Wa Link vinculado y bot habilitado).
 * - POST { wa_reminders } → toggle opt-out.
 * - POST { test: true } → manda un WA de prueba al WhatsApp del comercio.
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  let waReminders: boolean | null = null;
  try {
    const row = await queryOne<{ wa_reminders: boolean | null }>(
      `SELECT wa_reminders FROM vendors WHERE id = $1 LIMIT 1`,
      [gate.vendor.id]
    );
    waReminders = row?.wa_reminders ?? null;
  } catch { /* sin migración: null */ }
  let linked = false;
  let waPhone: string | null = null;
  try {
    const bot = await queryOne<{ status: string | null; enabled: boolean; wa_phone: string | null }>(
      `SELECT status, enabled, wa_phone FROM vendor_wa_bots WHERE vendor_id = $1 LIMIT 1`,
      [gate.vendor.id]
    );
    linked = !!bot && bot.status === "linked" && bot.enabled !== false;
    waPhone = bot?.wa_phone || null;
  } catch { /* sin tabla: no vinculado */ }
  return NextResponse.json({ waReminders: waReminders !== false, linked, waPhone });
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  const body = await request.json().catch(() => ({}));

  if (body.test === true) {
    const vendor = await queryOne<{ whatsapp: string | null; store_name: string | null }>(
      `SELECT whatsapp, store_name FROM vendors WHERE id = $1 LIMIT 1`,
      [gate.vendor.id]
    ).catch(() => undefined);
    const phone = String(vendor?.whatsapp || "").replace(/\D/g, "");
    if (!phone) {
      return NextResponse.json({ error: "Cargá tu WhatsApp en la ficha primero" }, { status: 400 });
    }
    if (!isDaytimeAR()) {
      return NextResponse.json({ error: "Probá de día (9 a 21): de noche no se despierta a nadie" }, { status: 400 });
    }
    const r = await sendWaText({
      vendorId: gate.vendor.id,
      waId: phone,
      text: `✅ Prueba de Portal 659 (${vendor?.store_name || "tu local"}): tus recordatorios por WhatsApp funcionan.`,
    });
    if (!r.sent) {
      const hint =
        r.reason === "sin_relay" || r.reason === "bot_disabled"
          ? "Vinculá la app Portal Wa Link primero"
          : r.reason === "limits"
            ? "Límite anti-spam alcanzado, probá en un rato"
            : "No se pudo enviar (¿relay vinculado?)";
      return NextResponse.json({ error: hint }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  }

  if (typeof body.wa_reminders === "boolean") {
    try {
      await queryOne(`UPDATE vendors SET wa_reminders = $1 WHERE id = $2`, [body.wa_reminders, gate.vendor.id]);
    } catch {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-estetica-wa-reminders.sql en la base" },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: true, waReminders: body.wa_reminders });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
