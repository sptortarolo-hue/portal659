import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

const TZ_AR = "America/Argentina/Buenos_Aires";
const STEP_MIN = 30;

const DAY_KEYS = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

const toMinutes = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 24 || mm > 59) return null;
  return h * 60 + mm;
};

const fmt = (mins: number): string =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/**
 * Franjas [open,close] en minutos del día pedido, parseadas del formato del
 * editor ("lun: 09:00-13:00 y 17:00-22:00, ..."). NULL si no se puede parsear.
 */
function shiftsForDate(hours: string | null, dateISO: string): [number, number][] | null {
  if (!hours) return null;
  const d = new Date(dateISO + "T12:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const key = DAY_KEYS[d.getDay()];
  // Segmento del día: "lun: ..." hasta la próxima coma+día o fin.
  const seg = new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*([^,]+)`, "i").exec(hours);
  if (!seg) return null;
  const text = seg[1].trim().toLowerCase();
  if (/cerrado/.test(text)) return [];
  const times = [...text.matchAll(/(\d{1,2}):(\d{2})/g)].map((m) => Number(m[1]) * 60 + Number(m[2]));
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < times.length; i += 2) {
    if (times[i + 1] > times[i]) out.push([times[i], times[i + 1]]);
  }
  return out;
}

/**
 * Huecos disponibles de turnera para un día (estética + servicios).
 * GET /api/slot-availability?vendorId=&serviceId=&staffId=&date=YYYY-MM-DD
 * → { slots: [{time, available}], estimated, closed }.
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
  }>(`SELECT hours, open_override FROM vendors WHERE id = $1 LIMIT 1`, [vendorId]).catch(() => null);
  if (!vendor) return NextResponse.json({ slots: [], estimated: true, closed: false });
  if (vendor.open_override === false) {
    return NextResponse.json({ slots: [], estimated: false, closed: true });
  }

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

  const busy: [number, number][] = [];
  for (const b of rows) {
    if (staffId && b.staff_id && b.staff_id !== staffId) continue;
    if (b.starts_at && b.ends_at) {
      const dayStart = new Date(`${date}T00:00:00`).getTime();
      const bs = new Date(b.starts_at).getTime();
      const be = new Date(b.ends_at).getTime();
      if (!Number.isNaN(bs) && !Number.isNaN(be)) {
        busy.push([(bs - dayStart) / 60000, (be - dayStart) / 60000]);
        continue;
      }
    }
    const bs = toMinutes(b.booking_time);
    if (bs == null) continue;
    busy.push([bs, bs + (Number(b.duration_min) || 60)]);
  }

  const shifts = vendor.open_override === true ? [[9 * 60, 20 * 60] as [number, number]] : shiftsForDate(vendor.hours, date);
  // Sin horario parseable: día completo estimado (el POST valida igual).
  const ranges = shifts === null ? [[9 * 60, 20 * 60] as [number, number]] : shifts;
  const estimated = shifts === null && vendor.open_override !== true;

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

  const slots: { time: string; available: boolean }[] = [];
  for (const [open, close] of ranges) {
    for (let t = open; t + need <= close && slots.length < 48; t += STEP_MIN) {
      if (t < minStart) continue;
      const free = !busy.some(([bs, be]) => t < be && bs < t + need);
      slots.push({ time: fmt(t), available: free });
    }
  }
  return NextResponse.json({ slots, estimated, closed: ranges.length === 0 });
}, { maxRequests: 20 });
