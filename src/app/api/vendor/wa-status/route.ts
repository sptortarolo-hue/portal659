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
  let reminderT24Enabled = true;
  let reminderT24Hour = 18;
  let reminderT2Enabled = true;
  let reminderT2Hours = 2;
  let reminderT24Text: string | null = null;
  let reminderT2Text: string | null = null;
  try {
    const row = await queryOne<{
      wa_reminders: boolean | null;
      reminder_t24_enabled: boolean | null;
      reminder_t24_hour: number | null;
      reminder_t2_enabled: boolean | null;
      reminder_t2_hours: number | null;
      reminder_t24_text: string | null;
      reminder_t2_text: string | null;
    }>(
      `SELECT wa_reminders, reminder_t24_enabled, reminder_t24_hour, reminder_t2_enabled, reminder_t2_hours, reminder_t24_text, reminder_t2_text
       FROM vendors WHERE id = $1 LIMIT 1`,
      [gate.vendor.id]
    );
    waReminders = row?.wa_reminders ?? null;
    if (row?.reminder_t24_enabled !== null && row?.reminder_t24_enabled !== undefined) reminderT24Enabled = row.reminder_t24_enabled !== false;
    if (row?.reminder_t24_hour != null) reminderT24Hour = row.reminder_t24_hour;
    if (row?.reminder_t2_enabled !== null && row?.reminder_t2_enabled !== undefined) reminderT2Enabled = row.reminder_t2_enabled !== false;
    if (row?.reminder_t2_hours != null) reminderT2Hours = row.reminder_t2_hours;
    reminderT24Text = row?.reminder_t24_text ?? null;
    reminderT2Text = row?.reminder_t2_text ?? null;
  } catch { /* sin migración: defaults */ }
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
  return NextResponse.json({
    waReminders: waReminders !== false,
    linked,
    waPhone,
    reminderT24Enabled,
    reminderT24Hour,
    reminderT2Enabled,
    reminderT2Hours,
    reminderT24Text,
    reminderT2Text,
  });
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

  // Configuración de recordatorios (horarios + texto).
  const hasReminderConfig =
    typeof body.reminder_t24_enabled === "boolean" ||
    typeof body.reminder_t24_hour === "number" ||
    typeof body.reminder_t2_enabled === "boolean" ||
    typeof body.reminder_t2_hours === "number" ||
    typeof body.reminder_t24_text === "string" ||
    body.reminder_t24_text === null ||
    typeof body.reminder_t2_text === "string" ||
    body.reminder_t2_text === null;

  if (hasReminderConfig) {
    const sets: string[] = [];
    const params: unknown[] = [gate.vendor.id];
    if (typeof body.reminder_t24_enabled === "boolean") {
      params.push(body.reminder_t24_enabled); sets.push(`reminder_t24_enabled = $${params.length}`);
    }
    if (typeof body.reminder_t24_hour === "number" && body.reminder_t24_hour >= 0 && body.reminder_t24_hour <= 23) {
      params.push(Math.round(body.reminder_t24_hour)); sets.push(`reminder_t24_hour = $${params.length}`);
    }
    if (typeof body.reminder_t2_enabled === "boolean") {
      params.push(body.reminder_t2_enabled); sets.push(`reminder_t2_enabled = $${params.length}`);
    }
    if (typeof body.reminder_t2_hours === "number" && body.reminder_t2_hours >= 1 && body.reminder_t2_hours <= 24) {
      params.push(Math.round(body.reminder_t2_hours)); sets.push(`reminder_t2_hours = $${params.length}`);
    }
    if (typeof body.reminder_t24_text === "string" || body.reminder_t24_text === null) {
      params.push(body.reminder_t24_text === null ? null : String(body.reminder_t24_text).slice(0, 1000));
      sets.push(`reminder_t24_text = $${params.length}`);
    }
    if (typeof body.reminder_t2_text === "string" || body.reminder_t2_text === null) {
      params.push(body.reminder_t2_text === null ? null : String(body.reminder_t2_text).slice(0, 1000));
      sets.push(`reminder_t2_text = $${params.length}`);
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
    }
    try {
      await queryOne(`UPDATE vendors SET ${sets.join(", ")} WHERE id = $1`, params);
    } catch {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-reminder-hours.sql en la base" },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
