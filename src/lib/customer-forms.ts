import { queryMany, queryOne } from "@/lib/db";

export type BookingFormState = {
  id: string;
  name: string;
  require_before: boolean;
  entry_status: string | null;
  public_token: string | null;
};

/**
 * Modelos de ficha pendientes del turno (para el banner de /turno/[token]).
 * Solo modelos activos del comercio que apliquen al servicio del turno,
 * con el estado de la última sesión de la clienta.
 */
export async function templatesForBooking(bookingToken: string): Promise<BookingFormState[]> {
  try {
    const booking = await queryOne<{ vendor_id: string; service_id: string | null; customer_phone: string | null }>(
      `SELECT vendor_id::text AS vendor_id, service_id::text AS service_id, customer_phone FROM bookings WHERE confirm_token = $1 LIMIT 1`,
      [bookingToken]
    ).catch(() => null);
    if (!booking) return [];
    const templates = await queryMany<{ id: string; name: string; service_ids: string[]; require_before: boolean }>(
      `SELECT id::text AS id, name, service_ids, require_before FROM customer_form_templates
       WHERE vendor_id = $1 AND active = true ORDER BY position ASC, name ASC`,
      [booking.vendor_id]
    ).catch(() => []);
    const out: BookingFormState[] = [];
    for (const t of templates || []) {
      const attached = Array.isArray(t.service_ids) ? t.service_ids.map(String) : [];
      if (attached.length > 0 && booking.service_id && !attached.includes(booking.service_id)) continue;
      let entry: { status: string; public_token: string } | undefined;
      try {
        const rows = await queryMany<{ status: string; public_token: string }>(
          `SELECT status, public_token FROM customer_form_entries
           WHERE vendor_id = $1 AND template_id = $2 AND customer_phone = $3
           ORDER BY created_at DESC LIMIT 1`,
          [booking.vendor_id, t.id, booking.customer_phone]
        );
        entry = rows?.[0];
      } catch { /* sin tabla */ }
      out.push({
        id: String(t.id),
        name: String(t.name ?? ""),
        require_before: t.require_before === true,
        entry_status: entry?.status || null,
        public_token: entry?.public_token || null,
      });
    }
    return out;
  } catch {
    return [];
  }
}
