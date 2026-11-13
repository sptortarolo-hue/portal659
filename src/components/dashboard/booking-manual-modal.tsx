"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CustomerPicker } from "@/components/dashboard/quote-manual-modal";
import { EquipmentPicker } from "@/components/dashboard/equipment-picker";
import type { Equipment } from "@/lib/equipment";
import { equipmentLabel } from "@/lib/equipment";

type ServiceOption = {
  id: string;
  name: string;
  deposit_amount?: number | null;
  require_deposit?: boolean | null;
};

/** wa.me con el texto ya armado (el teléfono viene E164 del CRM). */
function waHref(phone: string, text: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function BookingManualModal({
  initialDate,
  onClose,
  onCreated,
  serviceOptions,
  staffOptions,
  locationOptions,
  initialCustomerName,
  initialCustomerPhone,
  initialServiceId,
  initialStaffId,
  initialDurationMin,
  initialNotes,
  initialLocationId,
  booking,
  equipment,
  canChargeDeposits = false,
}: {
  initialDate?: string;
  onClose: () => void;
  onCreated: (warning?: string | null) => void;
  serviceOptions?: ServiceOption[];
  staffOptions?: { id: string; name: string }[];
  locationOptions?: { id: string; name: string }[];
  initialCustomerName?: string;
  initialCustomerPhone?: string;
  initialServiceId?: string;
  initialStaffId?: string;
  initialDurationMin?: number;
  initialNotes?: string;
  initialLocationId?: string;
  /** Turno existente → modo edición (PATCH en vez de POST). */
  booking?: any | null;
  /** Taller: muestra el picker de equipo (ficha por bici/moto/auto/electro/celular/PC). */
  equipment?: boolean;
  /** Mercado Pago conectada: permite cobrar la seña al agendar (QR / link). */
  canChargeDeposits?: boolean;
}) {
  const editing = !!booking;
  const [customerName, setCustomerName] = useState(
    editing ? String(booking.customer_name || "") : initialCustomerName || ""
  );
  const [customerPhone, setCustomerPhone] = useState(
    editing ? String(booking.customer_phone || "") : initialCustomerPhone || ""
  );
  const [serviceName, setServiceName] = useState(editing ? String(booking.product_name || "") : "");
  const [serviceId, setServiceId] = useState(
    editing ? String(booking.service_id || "") : initialServiceId || ""
  );
  const [staffId, setStaffId] = useState(
    editing ? String(booking.staff_id || "") : initialStaffId || ""
  );
  const [locationId, setLocationId] = useState(
    editing ? String(booking.location_id || "") : initialLocationId || ""
  );
  const [bookingDate, setBookingDate] = useState(
    editing
      ? String(booking.booking_date || "").slice(0, 10)
      : initialDate || new Date().toISOString().slice(0, 10)
  );
  const [bookingTime, setBookingTime] = useState(
    editing ? String(booking.booking_time || "").slice(0, 5) : ""
  );
  const [duration, setDuration] = useState(
    String((editing ? booking.duration_min : initialDurationMin) || 60)
  );
  const [notes, setNotes] = useState(editing ? String(booking.notes || "") : initialNotes || "");
  // Ficha de equipo (taller): preferencia precargada en modo edición.
  const [equip, setEquip] = useState<Equipment | null>(null);
  const [equipDetected] = useState<string>(
    editing ? String(booking?.equipment_id || "") : ""
  );
  useEffect(() => {
    if (!equipDetected) return;
    fetch(`/api/vendor/equipment?id=${encodeURIComponent(equipDetected)}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.equipment) && d.equipment[0]) setEquip(d.equipment[0] as Equipment);
      })
      .catch(() => {});
  }, [equipDetected]);

  // ---- Seña (igual que el micrositio): el monto sale del servicio ----
  const chosenService = serviceOptions?.find((s) => s.id === serviceId);
  const depositAmount = editing
    ? Number(booking?.deposit_amount) || 0
    : chosenService?.deposit_amount != null
      ? Number(chosenService.deposit_amount)
      : 0;
  const [chargeDeposit, setChargeDeposit] = useState(false);
  useEffect(() => {
    // Default: cobrar seña si el servicio la exige y hay MP conectada.
    setChargeDeposit(!editing && canChargeDeposits && chosenService?.require_deposit === true);
  }, [serviceId, canChargeDeposits, editing]);
  const wantsDeposit = !editing && canChargeDeposits && chargeDeposit && depositAmount > 0;

  // ---- Paso de cobro (tras crear el turno) ----
  const [cobro, setCobro] = useState<{ bookingId: string; amount: number } | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrExpires, setQrExpires] = useState<string | null>(null);
  const [payLink, setPayLink] = useState<string | null>(null);
  const [cobroBusy, setCobroBusy] = useState<"qr" | "link" | null>(null);
  const [cobroMsg, setCobroMsg] = useState("");
  const [copied, setCopied] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setError("");
    if (!customerName.trim() || !customerPhone.trim() || !bookingDate || !bookingTime) {
      setError("Faltan cliente, teléfono, fecha u hora");
      return;
    }
    setSaving(true);
    try {
      const url = editing ? `/api/vendor/bookings/${booking.id}` : "/api/vendor/bookings";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          // Taller: product_name = etiqueta del equipo (no se pisa con null).
          product_name: serviceId ? (equip ? equipmentLabel(equip) || null : null) : serviceName.trim() || null,
          service_id: serviceId || null,
          staff_id: staffId || null,
          location_id: locationId || null,
          booking_date: bookingDate,
          booking_time: bookingTime,
          duration_min: Number(duration) || 60,
          notes: notes.trim() || null,
          ...(equipment ? { equipment_id: equip?.id || null } : {}),
          ...(wantsDeposit ? { charge_deposit: true } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "No se pudo guardar");
      // Con seña pendiente no cerramos: mostramos el paso de cobro (QR / link).
      if (wantsDeposit && data?.deposit?.status === "pending") {
        const id = String(data.booking?.id || data.booking_id || "");
        if (id) {
          setCobro({ bookingId: id, amount: Number(data.deposit.amount) || depositAmount });
          return;
        }
      }
      const warns = [data.warning, data.blockWarning, data.scheduleWarning].filter(Boolean);
      onCreated(warns.length > 0 ? warns.join(" · ") : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function generateQr() {
    if (!cobro) return;
    setCobroBusy("qr");
    setCobroMsg("");
    try {
      const res = await fetch("/api/vendor/mp-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: cobro.amount,
          bookingId: cobro.bookingId,
          concept: `Seña turno — ${customerName.trim() || "cliente"}`,
        }),
      });
      const data = await res.json();
      if (data.error || !data.qrImage) {
        setCobroMsg(data.error || "No se pudo generar el QR");
        return;
      }
      setQrImage(data.qrImage);
      setQrExpires(data.expiresAt || null);
    } catch {
      setCobroMsg("Error de conexión");
    } finally {
      setCobroBusy(null);
    }
  }

  async function generateLink() {
    if (!cobro) return;
    setCobroBusy("link");
    setCobroMsg("");
    try {
      const res = await fetch(`/api/vendor/bookings/${cobro.bookingId}/deposit`, { method: "POST" });
      const data = await res.json();
      if (data.error || !data.initPoint) {
        setCobroMsg(data.error || "No se pudo generar el link");
        return;
      }
      setPayLink(data.initPoint);
    } catch {
      setCobroMsg("Error de conexión");
    } finally {
      setCobroBusy(null);
    }
  }

  async function copyLink() {
    if (!payLink) return;
    try {
      await navigator.clipboard.writeText(payLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCobroMsg("No se pudo copiar: seleccioná el link a mano");
    }
  }

  const waText = payLink
    ? `¡Hola ${customerName.trim() || ""}! Te reservé el turno del ${bookingDate} a las ${bookingTime}. Para confirmarlo aboná la seña de $${cobro?.amount.toLocaleString("es-AR")} desde este link: ${payLink}`
    : "";

  const money = (n: number) => `$${n.toLocaleString("es-AR")}`;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-card rounded-t-2xl sm:rounded-2xl border border-border w-full sm:max-w-md sm:mx-4 max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 pb-3 shrink-0">
          <h3 className="font-display text-lg font-semibold">
            {cobro ? "💰 Cobrar la seña" : editing ? "✏️ Editar turno" : "＋ Nuevo turno"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {cobro
              ? "El turno quedó pendiente de seña (no ocupa horario hasta que se acredite)."
              : editing
                ? "Cambiá la fecha, el horario o los datos. Se avisa al cliente si cambia el horario."
                : initialCustomerName
                  ? `Repitiendo el turno de ${initialCustomerName}. Elegí la nueva fecha.`
                  : "Nace confirmado (entra a recordatorios). No cuenta para el tope."}
          </p>
        </div>
        <div className="overflow-y-auto px-5 pb-3 space-y-3 flex-1 min-h-0">
          {cobro ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-border p-3 text-center">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Seña a cobrar</p>
                <p className="font-display text-2xl font-bold tabular-nums">{money(cobro.amount)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {customerName.trim()} · {bookingDate} {bookingTime}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={generateQr} disabled={cobroBusy !== null}>
                  {cobroBusy === "qr" ? "Generando..." : "📲 Generar QR"}
                </Button>
                <Button variant="outline" onClick={generateLink} disabled={cobroBusy !== null}>
                  {cobroBusy === "link" ? "Generando..." : "🔗 Generar link MP"}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                <strong>QR</strong>: el cliente lo escanea y paga en el local (vence en 10 minutos).{" "}
                <strong>Link</strong>: para turnos pedidos por teléfono, se manda por WhatsApp.
              </p>

              {qrImage && (
                <div className="rounded-xl border border-border p-3 text-center space-y-1">
                  <img src={qrImage} alt="QR de cobro" className="mx-auto h-44 w-44" />
                  <p className="text-[11px] text-muted-foreground">
                    {qrExpires ? `Vence: ${new Date(qrExpires).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : "Vence en 10 minutos"}
                    {" · "}cuando se acredite, la seña queda marcada sola.
                  </p>
                </div>
              )}

              {payLink && (
                <div className="rounded-xl border border-border p-3 space-y-2">
                  <p className="text-xs font-medium">Link de cobro</p>
                  <p className="text-[11px] text-muted-foreground break-all">{payLink}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={copyLink}>
                      {copied ? "✓ Copiado" : "Copiar link"}
                    </Button>
                    <a
                      href={waHref(customerPhone, waText)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
                    >
                      Enviar por WhatsApp
                    </a>
                  </div>
                </div>
              )}

              {cobroMsg && <p className="text-sm text-red-600">{cobroMsg}</p>}
            </div>
          ) : (
            <>
              <CustomerPicker name={customerName} phone={customerPhone} onPick={(n, p) => { setCustomerName(n); setCustomerPhone(p); }} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Cliente *</Label>
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nombre" className="mt-1 h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Teléfono *</Label>
                  <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="221 555 0000" className="mt-1 h-9 text-sm" />
                </div>
              </div>
              {serviceOptions && serviceOptions.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Servicio</Label>
                    <select
                      value={serviceId}
                      onChange={(e) => setServiceId(e.target.value)}
                      className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    >
                      <option value="">Sin servicio / otro</option>
                      {serviceOptions.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Profesional</Label>
                    <select
                      value={staffId}
                      onChange={(e) => setStaffId(e.target.value)}
                      className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                    >
                      <option value="">Sin asignar</option>
                      {(staffOptions || []).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div>
                  <Label className="text-xs">Servicio</Label>
                  <Input value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="Ej: arreglo, instalación..." className="mt-1 h-9 text-sm" />
                </div>
              )}
              {equipment && (
                <EquipmentPicker
                  phone={customerPhone}
                  customerName={customerName}
                  value={equip}
                  onChange={setEquip}
                />
              )}
              {locationOptions && locationOptions.length > 0 && (
                <div>
                  <Label className="text-xs">Sede</Label>
                  <select
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  >
                    <option value="">Sin sede</option>
                    {locationOptions.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Fecha *</Label>
                  <Input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className="mt-1 h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Hora *</Label>
                  <Input type="time" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} className="mt-1 h-9 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Duración (min)</Label>
                  <Input type="number" min={15} max={480} value={duration} onChange={(e) => setDuration(e.target.value)} className="mt-1 h-9 text-sm" />
                </div>
              </div>
              {!editing && canChargeDeposits && depositAmount > 0 && (
                <div className="rounded-xl border border-border p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Seña: {money(depositAmount)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {chosenService?.require_deposit
                          ? "Este servicio la exige. El turno nace pendiente hasta que se acredite."
                          : "Opcional: el turno nace pendiente hasta que se acredite."}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={chargeDeposit}
                        onChange={(e) => setChargeDeposit(e.target.checked)}
                      />
                      Cobrar
                    </label>
                  </div>
                </div>
              )}
              <div>
                <Label className="text-xs">Notas</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Dirección, referencias..." rows={2} className="mt-1 text-sm" />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>
        <div className="border-t border-border px-5 py-3 shrink-0 bg-card flex gap-2">
          {cobro ? (
            <>
              <Button variant="outline" className="flex-1" onClick={onClose}>
                Cerrar
              </Button>
              <Button className="flex-1" onClick={() => onCreated("Turno agendado con seña pendiente de cobro")}>
                Listo
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
              <Button className="flex-1" disabled={saving} onClick={submit}>
                {saving ? "Guardando..." : editing ? "Guardar cambios" : wantsDeposit ? "Agendar y cobrar seña" : "Agendar turno"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
