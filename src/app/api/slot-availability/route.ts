import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import {
  SLOT_STEP_MIN,
  fmtMinutes,
  shiftsFromHoursText,
  staffRangesForDate,
  toMinutes,
  type Range,
} from "@/lib/booking-schedule";

const TZ_AR = "America/Argentina/Buenos_Aires";

/**
 * Huecos disponibles de turnera para un día (estética + servicios).
 * GET /api/slot-availability?vendorId=&serviceId=&staffId=&date=YYYY-MM-DD
 * → { slots: [{time, available}], estimated, closed }.
 *
 * Modo `hours` (default): usa el horario del local.
 * Modo `grid`: disponibilidad por profesional (semanal recurrente + ajustes
 *   por fecha); lo no marcado queda bloqueado. Sin profesional elegido, el
 *   hueco es libre si algún profesional lo tiene disponible y sin solape.
 * El POST /api/bookings sigue siendo la autoridad (409 ante carrera).
 */
export const GET = withRateLimit(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const vendorId = searchParams.get("vendorId") || "";
  const serviceId = searchParams.get("serviceId") || "";
  const staffId = searchParams.get("staffId") || "";
  const date = searchParams.get("date") || "";
  if (!/^[0-9a-f-]{36}$/i.test(vendorId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ slots: [], estimated: true, closed: false });
  }

  const vendor = await queryOne<{
    hours: string | null;
    open_override: boolean | null;
    booking_schedule_mode: string | null;
  }>(
    `SELECT hours, open_override, booking_schedule_mode FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  ).catch(() => null);
  if (!vendor) return NextResponse.json({ slots: [], estimated: true, closed: false });
  if (vendor.open_override === false) {
    return NextResponse.json({ slots: [], estimated: false, closed: true });
  }
  const mode = String(vendor.booking_schedule_mode || "hours");

  // Días bloqueados (feriados/vacaciones): staff NULL = todo el centro.
  // Sin tabla (migración pendiente): se ignora.
  try {
    const blocks = await queryMany<{ staff_id: string | null; reason: string | null }>(
      `SELECT staff_id::text AS staff_id, reason FROM estetica_blocks
       WHERE vendor_id = $1 AND block_date = $2::date LIMIT 20`,
      [vendorId, date]
    ).catch(() => []);
    const hit = (blocks || []).find((b) => !b.staff_id || (staffId && b.staff_id === staffId));
    if (hit) {
      return NextResponse.json({ slots: [], estimated: false, closed: true, blocked: true });
    }
  } catch { /* sin tabla: sin bloqueo */ }

  let durationMin = 60;
  let bufferMin = 0;
  if (serviceId) {
    const svc = await queryOne<{ duration_min: number | null; buffer_min: number | null; active: boolean | null }>(
      `SELECT duration_min, buffer_min, active FROM services WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [serviceId, vendorId]
    ).catch(() => null);
    if (!svc || svc.active === false) return NextResponse.json({ slots: [], estimated: true, closed: false });
    if (Number(svc.duration_min) > 0) durationMin = Math.min(480, Math.max(15, Math.floor(Number(svc.duration_min))));
    if (Number(svc.buffer_min) > 0) bufferMin = Math.min(120, Math.max(0, Math.floor(Number(svc.buffer_min))));
  }
  const need = durationMin + bufferMin;

  if (staffId) {
    const st = await queryOne<{ id: string }>(
      `SELECT id FROM estetica_staff WHERE id = $1 AND vendor_id = $2 AND active = true LIMIT 1`,
      [staffId, vendorId]
    ).catch(() => null);
    if (!st) return NextResponse.json({ slots: [], estimated: true, closed: false });
  }

  // Turnos que ocupan ese día (misma lógica de solape que POST /api/bookings).
  type Row = { booking_time: string; duration_min: number | null; starts_at: string | null; ends_at: string | null; staff_id: string | null };
  let rows: Row[] = [];
  try {
    rows =
      (await queryMany<Row>(
        `SELECT booking_time::text AS booking_time, duration_min, starts_at::text AS starts_at,
                ends_at::text AS ends_at, staff_id::text AS staff_id
         FROM bookings WHERE vendor_id = $1 AND booking_date = $2 AND status IN ('pending', 'confirmed')`,
        [vendorId, date]
      )) || [];
  } catch {
    rows = [];
  }
  const dayStartMs = new Date(`${date}T00:00:00`).getTime();
  const busy: { staff_id: string | null; start: number; end: number }[] = [];
  for (const b of rows) {
    if (b.starts_at && b.ends_at) {
      const bs = new Date(b.starts_at).getTime();
      const be = new Date(b.ends_at).getTime();
      if (!Number.isNaN(bs) && !Number.isNaN(be)) {
        busy.push({ staff_id: b.staff_id, start: (bs - dayStartMs) / 60000, end: (be - dayStartMs) / 60000 });
        continue;
      }
    }
    const bs = toMinutes(b.booking_time);
    if (bs == null) continue;
    busy.push({ staff_id: b.staff_id, start: bs, end: bs + (Number(b.duration_min) || 60) });
  }

  // Carriles de disponibilidad: en grid, uno por profesional; si no, uno solo.
  type Lane = { staffId: string | null; ranges: Range[] | null };
  let lanes: Lane[];
  if (mode === "grid" && vendor.open_override !== true) {
    const staffRows = await queryMany<{ id: string; availability: unknown }>(
      `SELECT id::text AS id, availability FROM estetica_staff
       WHERE vendor_id = $1 AND COALESCE(active, true) = true`,
      [vendorId]
    ).catch(() => []);
    const overrides = await queryMany<{ staff_id: string; ranges: unknown }>(
      `SELECT staff_id::text AS staff_id, ranges FROM staff_schedule_days
       WHERE vendor_id = $1 AND day = $2::date`,
      [vendorId, date]
    ).catch(() => []);
    const overrideMap = new Map<string, unknown>((overrides || []).map((o) => [String(o.staff_id), o.ranges]));
    const list = staffId ? (staffRows || []).filter((s) => String(s.id) === staffId) : staffRows || [];
    lanes = list.map((s) => {
      const key = String(s.id);
      return {
        staffId: key,
        ranges: staffRangesForDate({
          mode,
          hoursText: vendor.hours,
          availability: s.availability,
          overrideRanges: overrideMap.has(key) ? overrideMap.get(key) : undefined,
          dateISO: date,
        }),
      };
    });
  } else {
    const shifts = vendor.open_override === true ? ([[9 * 60, 20 * 60]] as Range[]) : shiftsFromHoursText(vendor.hours, date);
    lanes = [{ staffId: staffId || null, ranges: shifts }];
  }

  // Filas/columnas estimadas si alguna fuente no se pudo parsear.
  const estimated = lanes.length === 0 ? false : lanes.some((l) => l.ranges === null);
  const effective = lanes.map((l) => ({
    staffId: l.staffId,
    ranges: l.ranges ?? ([[9 * 60, 20 * 60]] as Range[]),
  }));
  const closed = effective.length === 0 || effective.every((e) => e.ranges.length === 0);

  // Hoy: solo desde ahora + 30 min.
  let minStart = 0;
  try {
    const todayAR = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ_AR, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    if (date === todayAR) {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: TZ_AR, hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(new Date());
      const get = (t: string) => parts.find((p) => p.type === t)?.value || "0";
      minStart = Number(get("hour")) * 60 + Number(get("minute")) + 30;
    }
  } catch { /* sin filtro */ }

  const busyBlocks = (laneStaffId: string | null, start: number, end: number): boolean =>
    busy.some((b) => {
      const applies = !laneStaffId ? true : b.staff_id == null || b.staff_id === laneStaffId;
      if (!applies) return false;
      return start < b.end && b.start < end;
    });

  // Unión por horario: el hueco existe si algún carril lo ofrece y está libre.
  const map = new Map<string, boolean>();
  for (const lane of effective) {
    for (const [open, close] of lane.ranges) {
      for (let t = open; t + need <= close && map.size < 60; t += SLOT_STEP_MIN) {
        if (t < minStart) continue;
        const time = fmtMinutes(t);
        const free = !busyBlocks(lane.staffId, t, t + need);
        const prev = map.get(time);
        map.set(time, prev === undefined ? free : prev || free);
      }
    }
  }
  const slots = [...map.entries()]
    .map(([time, available]) => ({ time, available }))
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(0, 48);

  return NextResponse.json({ slots, estimated, closed });
}, { maxRequests: 20 });
