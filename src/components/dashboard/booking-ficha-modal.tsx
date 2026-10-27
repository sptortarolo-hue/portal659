"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fName, setFName] = useState("");
  const [fAddress, setFAddress] = useState("");
  const [fBirthdate, setFBirthdate] = useState("");
  const [fAllergies, setFAllergies] = useState("");
  const [fSkin, setFSkin] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fConsent, setFConsent] = useState<boolean>(false);

  useEffect(() => {
    if (!open || !phone) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setMsg("");
      setEditing(false);
      try {
        const res = await fetch("/api/vendor/customers", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        if (res.ok && Array.isArray(data.customers)) {
          const found = data.customers.find((c: any) => String(c.phone) === phone);
          if (found) {
            const c: Customer = {
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
            };
            setCustomer(c);
            setFName(c.name || "");
            setFAddress(c.address || "");
            setFBirthdate(c.birthdate ? String(c.birthdate).slice(0, 10) : "");
            setFAllergies(c.allergies || "");
            setFSkin(c.skin_notes || "");
            setFNotes(c.notes || "");
            setFConsent(!!c.consent_at);
          } else {
            setCustomer(null);
            setFName(booking?.customer_name ? String(booking.customer_name) : "");
            setFAddress("");
            setFBirthdate("");
            setFAllergies("");
            setFSkin("");
            setFNotes("");
            setFConsent(false);
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
  }, [open, phone, booking]);

  if (!open) return null;

  const name = customer?.name || (fName.trim() || null) || booking?.customer_name || "Sin nombre";
  const phoneDisplay = phone || booking?.customer_phone || "";

  async function saveCustomer() {
    setSaving(true);
    setMsg("");
    try {
      const payload: Record<string, unknown> = {
        name: fName.trim() || null,
        address: fAddress.trim() || null,
        notes: fNotes.trim() || null,
        allergies: fAllergies.trim() || null,
        skin_notes: fSkin.trim() || null,
        birthdate: fBirthdate || null,
        consent: fConsent,
      };
      let res: Response;
      if (customer) {
        res = await fetch(`/api/vendor/customers/${customer.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });
      } else {
        if (!fName.trim()) {
          setMsg("Falta el nombre para crear la ficha.");
          setSaving(false);
          return;
        }
        res = await fetch("/api/vendor/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ phone, name: fName.trim(), address: fAddress.trim() || null, notes: fNotes.trim() || null, allergies: fAllergies.trim() || null, skin_notes: fSkin.trim() || null }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.customer) {
        setMsg(data.error || "No se pudo guardar");
        return;
      }
      // Si se creó ahora, PATCH para birthdate/consent (POST no los persiste)
      let finalData = data;
      if (!customer && (fBirthdate || fConsent)) {
        try {
          const r2 = await fetch(`/api/vendor/customers/${data.customer.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ birthdate: fBirthdate || null, consent: fConsent }),
          });
          const d2 = await r2.json().catch(() => ({}));
          if (r2.ok && d2.customer) finalData = d2;
        } catch { /* best-effort */ }
      }
      const c: Customer = {
        id: String(finalData.customer.id),
        phone: String(finalData.customer.phone),
        name: finalData.customer.name != null ? String(finalData.customer.name) : null,
        address: finalData.customer.address != null ? String(finalData.customer.address) : null,
        notes: finalData.customer.notes != null ? String(finalData.customer.notes) : null,
        allergies: finalData.customer.allergies != null ? String(finalData.customer.allergies) : null,
        skin_notes: finalData.customer.skin_notes != null ? String(finalData.customer.skin_notes) : null,
        consent_at: finalData.customer.consent_at != null ? String(finalData.customer.consent_at) : null,
        birthdate: finalData.customer.birthdate != null ? String(finalData.customer.birthdate) : null,
        total_orders: Number(finalData.customer.total_orders || 0),
        total_spent: Number(finalData.customer.total_spent || 0),
      };
      setCustomer(c);
      setFName(c.name || "");
      setFAddress(c.address || "");
      setFBirthdate(c.birthdate ? String(c.birthdate).slice(0, 10) : "");
      setFAllergies(c.allergies || "");
      setFSkin(c.skin_notes || "");
      setFNotes(c.notes || "");
      setFConsent(!!c.consent_at);
      setEditing(false);
      setMsg("Ficha guardada ✓");
    } catch {
      setMsg("Error de conexión.");
    } finally {
      setSaving(false);
    }
  }

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
            <div className="rounded-lg border border-border bg-muted p-3 space-y-2 text-xs mb-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Datos del cliente
                </span>
                {!editing ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px]"
                    onClick={() => setEditing(true)}
                  >
                    ✏️ Editar
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">editando…</span>
                )}
              </div>

              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Teléfono</span>
                <span className="font-medium">
                  {phoneDisplay || "—"}
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

              {!editing ? (
                <>
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
                      Aún no hay ficha del cliente. Tocá ✏️ Editar para cargar los datos.
                    </p>
                  )}
                </>
              ) : (
                <div className="space-y-2 pt-1">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Nombre</Label>
                    <Input className="h-8 text-xs" value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Nombre del cliente" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Dirección</Label>
                    <Input className="h-8 text-xs" value={fAddress} onChange={(e) => setFAddress(e.target.value)} placeholder="Dirección" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Cumpleaños</Label>
                    <Input type="date" className="h-8 text-xs" value={fBirthdate} onChange={(e) => setFBirthdate(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Alergias / contraindicaciones</Label>
                    <Textarea className="text-xs min-h-[50px]" value={fAllergies} onChange={(e) => setFAllergies(e.target.value)} placeholder="Alergias, contraindicaciones" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Notas de piel</Label>
                    <Textarea className="text-xs min-h-[50px]" value={fSkin} onChange={(e) => setFSkin(e.target.value)} placeholder="Tipo de piel, notas" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Notas generales</Label>
                    <Textarea className="text-xs min-h-[50px]" value={fNotes} onChange={(e) => setFNotes(e.target.value)} placeholder="Notas" />
                  </div>
                  <label className="flex items-center gap-2 text-[11px]">
                    <input type="checkbox" checked={fConsent} onChange={(e) => setFConsent(e.target.checked)} />
                    Consentimiento firmado
                  </label>

                  {msg && <p className="text-[11px] text-amber-700">{msg}</p>}

                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="h-7 text-[11px] flex-1" onClick={saveCustomer} disabled={saving}>
                      {saving ? "Guardando..." : "💾 Guardar"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setEditing(false)} disabled={saving}>
                      Cancelar
                    </Button>
                  </div>
                </div>
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
              Ver datos
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