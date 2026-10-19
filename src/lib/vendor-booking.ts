import { queryMany, queryOne } from "@/lib/db";
import { fitsInRanges, shiftsFromHoursText, staffRangesForDate } from "@/lib/booking-schedule";

/** "09:30" → 570 (minutos desde medianoche). Null si no parsea. */
export function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Duración en minutos saneada (15..480, default 60). */
export function clampDuration(v: unknown): number {
  return Math.min(480, Math.max(15, Math.floor(Number(v) || 60)));
}

export type ResolvedBookingRefs = {
  durationMin: number;
  bufferMin: number;
  serviceId: string | null;
  staffId: string | null;
  locationId: string | null;
  serviceName: string | null;
  servicePrice: number | null;
  serviceCommission: number | null;
  staffCommission: number | null;
  /** Comisión a guardar como snapshot (servicio > profesional > null). */
  snapshotCommission: number | null;
};

/**
 * Resuelve servicio/profesional/sede de un turno (estética). Todo tolerante a
 * migraciones sin aplicar: si falta una tabla/columna, cae a null sin romper.
 * El servicio puede ajustar la duración (duración del servicio gana sobre la
 * pasada explícita), igual que en la creación online/manual.
 */
export async function resolveBookingRefs(
  vendorId: string,
  input: {
    serviceId?: string | null;
    staffId?: string | null;
    locationId?: string | null;
    durationMin?: unknown;
  }
): Promise<ResolvedBookingRefs> {
  let durationMin = clampDuration(input.durationMin ?? 60);
  let bufferMin = 0;
  let staffId: string | null = typeof input.staffId === "string" && input.staffId ? input.staffId : null;
  let serviceId: string | null = typeof input.serviceId === "string" && input.serviceId ? input.serviceId : null;
  let serviceName: string | null = null;
  let servicePrice: number | null = null;
  let serviceCommission: number | null = null;
  let staffCommission: number | null = null;

  try {
    if (serviceId) {
      const svc = await queryOne<{ name: string; duration_min: number | null; buffer_min: number | null; price: number | null; commission_pct: number | null }>(
        `SELECT name, duration_min, buffer_min, price, commission_pct FROM services WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [serviceId, vendorId]
      ).catch(() =>
        queryOne<{ name: string; duration_min: number | null; buffer_min: number | null; price: number | null; commission_pct: number | null }>(
          `SELECT name, duration_min, buffer_min FROM services WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
          [serviceId, vendorId]
        )
      );
      if (svc) {
        serviceName = svc.name;
        if (Number(svc.duration_min) > 0) durationMin = clampDuration(svc.duration_min);
        if (Number(svc.buffer_min) > 0) bufferMin = Math.min(120, Math.max(0, Math.floor(Number(svc.buffer_min))));
        if (svc.price != null && Number(svc.price) >= 0) servicePrice = Number(svc.price);
        if (svc.commission_pct != null && Number(svc.commission_pct) >= 0) serviceCommission = Number(svc.commission_pct);
      } else {
        serviceId = null;
      }
    }
    if (staffId) {
      const st = await queryOne<{ id: string; commission_pct: number | null }>(
        `SELECT id, commission_pct FROM estetica_staff WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [staffId, vendorId]
      ).catch(() =>
        queryOne<{ id: string; commission_pct: number | null }>(
          `SELECT id FROM estetica_staff WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
          [staffId, vendorId]
        )
      );
      if (!st) {
        staffId = null;
      } else if (st.commission_pct != null && Number(st.commission_pct) >= 0) {
        staffCommission = Number(st.commission_pct);
      }
    }
  } catch {
    staffId = null;
    serviceId = null;
  }

  const snapshotCommission = serviceCommission ?? staffCommission;

  let locationId: string | null = typeof input.locationId === "string" && input.locationId ? input.locationId : null;
  if (locationId) {
    try {
      const loc = await queryOne<{ id: string }>(
        `SELECT id FROM estetica_locations WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [locationId, vendorId]
      );
      if (!loc) locationId = null;
    } catch {
      locationId = null;
    }
  }

  return {
    durationMin,
    bufferMin,
    serviceId,
    staffId,
    locationId,
    serviceName,
    servicePrice,
    serviceCommission,
    staffCommission,
    snapshotCommission,
  };
}

/** Timestamps de inicio/fin (naive AR) para `starts_at`/`ends_at`. */
export function computeStartsEnds(
  dateISO: string,
  time: string,
  durationMin: number,
  bufferMin: number
): { startsAt: string | null; endsAt: string | null } {
  const start = toMinutes(time);
  if (start == null) return { startsAt: null, endsAt: null };
  const endMin = start + durationMin + bufferMin;
  return {
    startsAt: `${dateISO}T${String(time).slice(0, 5)}:00`,
    endsAt: `${dateISO}T${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}:00`,
  };
}

export type BookingWarnings = {
  overlapWarning: string | null;
  blockWarning: string | null;
  scheduleWarning: string | null;
};

/**
 * Avisos (nunca bloquean) para un horario de turno: solape con otro turno,
 * día bloqueado y horario fuera de la agenda del profesional (modo grid).
 * `excludeId` sirve al editar para no chocar contra el propio turno.
 */
export async function computeBookingWarnings(
  vendorId: string,
  opts: {
    dateISO: string;
    time: string;
    durationMin: number;
    bufferMin?: number;
    staffId?: string | null;
    excludeId?: string | null;
  }
): Promise<BookingWarnings> {
  const { dateISO, time, durationMin } = opts;
  const bufferMin = opts.bufferMin || 0;
  const staffId = opts.staffId || null;
  const start = toMinutes(time);
  let overlapWarning: string | null = null;
  let blockWarning: string | null = null;
  let scheduleWarning: string | null = null;

  if (start == null) return { overlapWarning, blockWarning, scheduleWarning };

  // Solape (no bloquea): turnos no cancelados del mismo día que se pisan.
  try {
    const params: unknown[] = [vendorId, dateISO];
    let excludeSql = "";
    if (opts.excludeId) {
      params.push(opts.excludeId);
      excludeSql = ` AND id <> $${params.length}`;
    }
    const sameDay = await queryMany<{ booking_time: string; duration_min: number | null; customer_name: string | null; staff_id: string | null }>(
      `SELECT booking_time::text AS booking_time, duration_min, customer_name, staff_id::text AS staff_id
       FROM bookings WHERE vendor_id = $1 AND booking_date = $2 AND status IN ('pending', 'confirmed')${excludeSql}`,
      params
    );
    const end = start + durationMin + bufferMin;
    const clash = (sameDay || []).find((b) => {
      if (staffId && b.staff_id && b.staff_id !== staffId) return false;
      const bs = toMinutes(b.booking_time);
      if (bs == null) return false;
      const be = bs + (Number(b.duration_min) || 60);
      return start < be && bs < end;
    });
    if (clash) {
      overlapWarning = `Se pisa con el turno de ${clash.customer_name || "otro cliente"} (${String(clash.booking_time).slice(0, 5)})`;
    }
  } catch { /* sin tabla: sin chequeo */ }

  // Día bloqueado (feriado/vacaciones): avisa sin bloquear.
  try {
    const blocks = await queryMany<{ staff_id: string | null; reason: string | null }>(
      `SELECT staff_id::text AS staff_id, reason FROM estetica_blocks
       WHERE vendor_id = $1 AND block_date = $2::date LIMIT 20`,
      [vendorId, dateISO]
    ).catch(() => []);
    const hit = (blocks || []).find((b) => !b.staff_id || (staffId && b.staff_id === staffId));
    if (hit) blockWarning = `Ese día está bloqueado${hit.reason ? `: ${hit.reason}` : ""}`;
  } catch { /* sin tabla: sin aviso */ }

  // Agenda planificada (modo grid): avisa si cae fuera de la disponibilidad.
  try {
    const vmode = await queryOne<{ booking_schedule_mode: string | null; hours: string | null }>(
      `SELECT booking_schedule_mode, hours FROM vendors WHERE id = $1 LIMIT 1`,
      [vendorId]
    ).catch(() => null);
    if (String(vmode?.booking_schedule_mode || "hours") === "grid") {
      const startM = start;
      const endM = start + durationMin + bufferMin;
      const staffRows = staffId
        ? await queryMany<{ id: string; availability: unknown }>(
            `SELECT id::text AS id, availability FROM estetica_staff
             WHERE vendor_id = $1 AND id = $2 AND COALESCE(active, true) = true`,
            [vendorId, staffId]
          ).catch(() => [])
        : await queryMany<{ id: string; availability: unknown }>(
            `SELECT id::text AS id, availability FROM estetica_staff
             WHERE vendor_id = $1 AND COALESCE(active, true) = true`,
            [vendorId]
          ).catch(() => []);
      const overrides = await queryMany<{ staff_id: string; ranges: unknown }>(
        `SELECT staff_id::text AS staff_id, ranges FROM staff_schedule_days
         WHERE vendor_id = $1 AND day = $2::date`,
        [vendorId, dateISO]
      ).catch(() => []);
      const overrideMap = new Map<string, unknown>((overrides || []).map((o) => [String(o.staff_id), o.ranges]));
      const lanes = (staffRows && staffRows.length > 0
        ? staffRows.map((s) => {
            const key = String(s.id);
            return staffRangesForDate({
              mode: "grid",
              hoursText: vmode?.hours ?? null,
              availability: s.availability,
              overrideRanges: overrideMap.has(key) ? overrideMap.get(key) : undefined,
              dateISO,
            });
          })
        : [shiftsFromHoursText(vmode?.hours ?? null, dateISO)]);
      const fits = lanes.some((ranges) => (ranges == null ? true : fitsInRanges(ranges, startM, endM)));
      if (!fits) scheduleWarning = "Ese horario está fuera de la agenda del profesional";
    }
  } catch { /* sin agenda: sin aviso */ }

  return { overlapWarning, blockWarning, scheduleWarning };
}

export function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}
