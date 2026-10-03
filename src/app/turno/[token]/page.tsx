import { queryOne } from "@/lib/db";
import { notFound } from "next/navigation";
import { TurnoConfirmButtons } from "./confirm-buttons";
import { TurnoFichaBanner } from "./ficha-banner";
import { templatesForBooking } from "@/lib/customer-forms";

export const dynamic = "force-dynamic";

type Booking = {
  id: string;
  customer_name: string | null;
  booking_date: string;
  booking_time: string;
  status: string;
  notes: string | null;
  store_name: string;
  slug: string | null;
  whatsapp: string | null;
  service_label: string | null;
  staff_label: string | null;
  location_label: string | null;
  cancel_policy_text: string | null;
  cancel_hours: number | null;
};

async function loadBooking(token: string): Promise<Booking | null> {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  try {
    const b = await queryOne<any>(
      `SELECT b.id, b.customer_name, b.booking_date::text AS booking_date,
              b.booking_time::text AS booking_time, b.status, b.notes,
              v.store_name, v.slug, v.whatsapp, v.cancel_policy_text, v.cancel_hours,
              s.name AS service_label, st.name AS staff_label, l.name AS location_label
       FROM bookings b
       JOIN vendors v ON v.id = b.vendor_id
       LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN estetica_staff st ON st.id = b.staff_id
       LEFT JOIN estetica_locations l ON l.id = b.location_id
       WHERE b.confirm_token = $1 LIMIT 1`,
      [token]
    );
    if (!b) return null;
    return {
      id: String(b.id),
      customer_name: b.customer_name,
      booking_date: String(b.booking_date),
      booking_time: String(b.booking_time).slice(0, 5),
      status: String(b.status),
      notes: b.notes,
      store_name: String(b.store_name ?? ""),
      slug: b.slug,
      whatsapp: b.whatsapp,
      service_label: b.service_label,
      staff_label: b.staff_label,
      location_label: b.location_label,
      cancel_policy_text: b.cancel_policy_text,
      cancel_hours: b.cancel_hours != null ? Number(b.cancel_hours) : null,
    };
  } catch {
    // Sin migración: sin página.
    return null;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso + "T12:00:00").toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  } catch {
    return iso;
  }
}

export default async function TurnoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const booking = await loadBooking(token);
  if (!booking) notFound();

  const waNumber = (booking.whatsapp || "").replace(/[^0-9]/g, "");
  const terminal = booking.status === "cancelled" || booking.status === "noshow";
  const fichaTemplates = terminal ? [] : await templatesForBooking(token);

  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-10 max-w-md">
        <div className="rounded-2xl border border-border bg-card p-6 space-y-4 text-center">
          <p className="text-3xl">📅</p>
          <div>
            <h1 className="font-display text-2xl font-semibold">{booking.store_name}</h1>
            <p className="text-sm text-muted-foreground mt-1">Tu turno</p>
          </div>
          <div className="rounded-xl bg-muted px-4 py-3 text-sm space-y-1">
            <p className="font-semibold text-base capitalize">{fmtDate(booking.booking_date)} · {booking.booking_time}</p>
            {booking.customer_name && <p className="text-muted-foreground">para {booking.customer_name}</p>}
            {booking.service_label && <p>💅 {booking.service_label}</p>}
            {booking.staff_label && <p>💇 Con {booking.staff_label}</p>}
            {booking.location_label && <p className="text-muted-foreground">📍 {booking.location_label}</p>}
          </div>
          {terminal ? (
            <p className="text-sm font-medium text-muted-foreground">
              {booking.status === "cancelled" ? "Este turno está cancelado." : "Este turno ya pasó."}
            </p>
          ) : (
            <>
              {fichaTemplates.length > 0 && (
                <TurnoFichaBanner bookingToken={token} templates={fichaTemplates} />
              )}
              <TurnoConfirmButtons
                token={token}
                initialStatus={booking.status}
                cancelHours={booking.cancel_hours ?? 24}
                cancelPolicy={booking.cancel_policy_text}
              />
            </>
          )}
          {booking.cancel_policy_text && !terminal && (
            <p className="text-xs text-muted-foreground">📝 {booking.cancel_policy_text}</p>
          )}
          {waNumber && (
            <a
              href={`https://wa.me/${waNumber}?text=${encodeURIComponent(`Hola ${booking.store_name}! Te escribo por mi turno del ${booking.booking_date}.`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs text-green-600 font-medium hover:underline"
            >
              ¿Dudas? Escribinos por WhatsApp
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
