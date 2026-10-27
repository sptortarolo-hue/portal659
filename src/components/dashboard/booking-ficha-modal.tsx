"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CustomerFormTimeline } from "@/components/dashboard/customer-form-timeline";

type Customer = {
  id: string;
  phone: string;
  name: string | null;
  address: string | null;
  notes: string | null;
  allergies?: string | null;
  skin_notes?: string | null;
  consent_at?: string | null;
  birthdate?: string | null;
  total_orders?: number;
  total_spent?: number;
};

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export type BookingFichaModalProps = {
  booking: any;
  open: boolean;
  onClose: () => void;
  onNavigate?: (section: "orders" | "pos" | "caja" | "config" | "pedidos" | "clientes") => void;
  vendorId?: string | null;
};

/**
 * Modal de ficha de la clienta abierta desde un turno: datos personales +
 * fichas de sesiones anteriores + posibilidad de crear una ficha para la
 * sesión recién atendida (vinculada a este turno). Reusa
 * CustomerFormTimeline (carga sesiones, edita, imprime) para no duplicar.
 */
export function BookingFichaModal({
  booking,
  open,
  onClose,
  onNavigate,
  vendorId,
}: BookingFichaModalProps) {
  const phone = booking?.customer_phone ? String(booking.customer_phone) : "";
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open || !phone) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setMsg("");
      try {
        const res = await fetch("/api/vendor/customers", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok && Array.isArray(data.customers)) {
          const found = data.customers.find((c: any) => String(c.phone) === phone);
          if (found) {
            setCustomer({
              id: String(found.id),
              phone: String(found.phone),
              name: found.name != null ? String(found.name) : null,
              address: found.address != null ? String(found.address) : null,
              notes: found.notes != null ? String(found.notes) : null,
              allergies: found.allergies != null ? String(found.allergies) : null,
              skin_notes: found.skin_notes != null ? String(found.skin_notes) : null,
              consent_at: found.consent_at != null ? String(found.consent_at) : null,
              birthdate: found.birthdate != null ? String(found.birthdate) : null,
              total_orders: Number(found.total_orders || 0),
              total_spent: Number(found.total_spent || 0),
            });
          } else {
            setCustomer(null);
          }
        } else if (res.status === 403) {
          setMsg("El libro de clientes forma parte de los planes pagos (Gestión integral).");
        } else {
          setMsg("No se pudo cargar la ficha.");
        }
      } catch {
        if (alive) setMsg("Error de conexión.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [open, phone]);

  if (!open) return null;

  const name = customer?.name || booking?.customer_name || "Sin nombre";
  const phoneDisplay = phone || booking?.customer_phone || "";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-[61] w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">📋 Ficha · {name}</h2>
          <Button size="sm" variant="outline" className="h-7" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        {loading ? (
          <p className="text-xs text-muted-foreground">Cargando ficha...</p>
        ) : (
          <>
            <div className="rounded-lg border border-border bg-muted p-3 space-y-1.5 text-xs mb-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Teléfono</span>
                <span className="font-medium">{phoneDisplay || "—"}
                  {phoneDisplay && (
                    <a
                      href={`https://wa.me/${String(phoneDisplay).replace(/[^0-9]/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 text-green-600 hover:underline"
                    >
                      📲
                    </a>
                  )}
                </span>
              </div>
              {customer?.address && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Dirección</span>
                  <span className="font-medium text-right">{customer.address}</span>
                </div>
              )}
              {customer?.birthdate && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cumpleaños</span>
                  <span className="font-medium">{fmtDate(customer.birthdate)}</span>
                </div>
              )}
              {customer?.allergies && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Alergias</span>
                  <span className="font-medium text-right">{customer.allergies}</span>
                </div>
              )}
              {customer?.skin_notes && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Notas de piel</span>
                  <span className="font-medium text-right">{customer.skin_notes}</span>
                </div>
              )}
              {customer?.consent_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Consentimiento</span>
                  <span className="font-medium">{fmtDate(customer.consent_at)}</span>
                </div>
              )}
              {customer?.notes && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Notas</span>
                  <span className="font-medium text-right">{customer.notes}</span>
                </div>
              )}
              {customer && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Visitas</span>
                  <span className="font-medium">{customer.total_orders ?? 0}</span>
                </div>
              )}
              {!customer && (
                <p className="text-xs text-muted-foreground italic pt-1">
                  Aún no hay ficha de clienta. Se crea automáticamente al cobrar el turno. Para crearla ahora, andá a Clientes.
                </p>
              )}
            </div>

            {phone && (
              <CustomerFormTimeline
                phone={phone}
                vendorId={vendorId}
                bookingId={booking?.id}
                onChanged={() => {}}
              />
            )}
          </>
        )}

        <div className="mt-4 flex gap-2">
          {onNavigate && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 flex-1"
              onClick={() => { onNavigate("clientes"); onClose(); }}
            >
              ✏️ Editar en Clientes
            </Button>
          )}
          <Button size="sm" className="h-9 flex-1" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
