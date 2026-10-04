"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimeSelect24 } from "@/components/ui/time-select-24";

type Props = {
  vendorId: string;
  vendorName: string;
  services?: { id: string; name: string }[];
  /** Catálogo de servicios de estética (con seña, duración y precio): reserva por ID. */
  serviceOptions?: { id: string; name: string; deposit_amount: number | null; duration_min: number | null; price?: number | null; require_deposit?: boolean | null; deposit_hours?: number | null }[];
  /** Profesionales del centro (agenda por profesional). */
  staffOptions?: { id: string; name: string }[];
  /** Sedes del centro (multi-sede light). */
  locationOptions?: { id: string; name: string; address?: string | null }[];
  /** Política de cancelación visible antes de reservar. */
  cancelPolicy?: string | null;
};

export function BookingForm({ vendorId, vendorName, services, serviceOptions, staffOptions, locationOptions, cancelPolicy }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [productName, setProductName] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [locationId, setLocationId] = useState("");
  // Sesiones de pack (estética): saldo por teléfono.
  const [credits, setCredits] = useState<{ pack_id: string; pack_name: string; remaining: number }[]>([]);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [usePackId, setUsePackId] = useState("");
  const [packMsg, setPackMsg] = useState("");
  const [depositPayUrl, setDepositPayUrl] = useState<string | null>(null);
  const [depositMsg, setDepositMsg] = useState("");
  // Grilla de huecos (estética con catálogo): evita probar horarios ocupados.
  const [slots, setSlots] = useState<{ time: string; available: boolean }[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsClosed, setSlotsClosed] = useState(false);
  // Lista de espera (el horario está ocupado).
  const [overlap, setOverlap] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [waitDone, setWaitDone] = useState(false);
  const [waitBusy, setWaitBusy] = useState(false);

  // Carta visual: "Elegir" preselecciona el servicio en el formulario.
  useEffect(() => {
    const onPick = (e: Event) => {
      const id = (e as CustomEvent)?.detail?.serviceId;
      if (typeof id === "string" && id) setServiceId(id);
    };
    window.addEventListener("portal:pick-service", onPick);
    return () => window.removeEventListener("portal:pick-service", onPick);
  }, []);
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const useCatalog = !!serviceOptions && serviceOptions.length > 0;
  const chosenService = useCatalog ? serviceOptions.find((s) => s.id === serviceId) : undefined;
  const useSlots = useCatalog && !!serviceId && !!bookingDate;

  useEffect(() => {
    if (!useSlots) {
      setSlots([]);
      setSlotsClosed(false);
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    const qs = new URLSearchParams({ vendorId, date: bookingDate, serviceId });
    if (staffId) qs.set("staffId", staffId);
    fetch(`/api/slot-availability?${qs.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setSlots(Array.isArray(d.slots) ? d.slots : []);
        setSlotsClosed(d.closed === true);
        if (bookingTime && Array.isArray(d.slots) && !d.slots.some((s: any) => s.time === bookingTime && s.available)) {
          setBookingTime("");
        }
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, serviceId, staffId, bookingDate, useSlots]);

  if (done) {
    return (
      <div className="text-center py-6">
        <p className="text-2xl mb-2">📅</p>
        <p className="font-medium">Turno reservado</p>
        <p className="text-sm text-muted-foreground mt-1">
          {bookingDate} a las {bookingTime}. {vendorName} te va a confirmar.
        </p>
        {packMsg && (
          <p className="text-sm mt-2 rounded-lg bg-green-50 border border-green-200 text-green-800 px-3 py-2">{packMsg}</p>
        )}
        {depositPayUrl && (
          <a href={depositPayUrl} className="block mt-3 rounded-xl bg-primary text-primary-foreground font-bold px-4 py-3 text-sm hover:bg-primary/90">
            💳 Pagar la seña ahora para confirmar
          </a>
        )}
        {depositMsg && (
          <p className="text-sm mt-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">{depositMsg}</p>
        )}
      </div>
    );
  }

  async function lookupCredits(phone: string) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setCredits([]);
      setUsePackId("");
      return;
    }
    setCreditsLoading(true);
    try {
      const res = await fetch(`/api/pack-credits?vendorId=${vendorId}&phone=${encodeURIComponent(phone)}`);
      const data = await res.json().catch(() => ({}));
      const list = Array.isArray(data.credits) ? data.credits : [];
      setCredits(list);
      setUsePackId(list.length > 0 ? list[0].pack_id : "");
    } catch {
      setCredits([]);
    } finally {
      setCreditsLoading(false);
    }
  }

  async function joinWaitlist() {    if (!name || !phone || !bookingDate) return;
    setWaitBusy(true);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId,
          customerName: name,
          customerPhone: phone,
          serviceId: useCatalog ? serviceId || null : null,
          staffId: staffId || null,
          bookingDate,
          bookingTime: bookingTime || null,
          notes: notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setError(data.error);
        return;
      }
      setWaitDone(true);
    } catch {
      setError("Error de conexión");
    } finally {
      setWaitBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone || !bookingDate || !bookingTime) return;
    setLoading(true);
    setError("");
    setOverlap(false);

    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId,
        customerName: name,
        customerPhone: phone,
        productName: useCatalog ? null : productName || null,
        serviceId: useCatalog ? serviceId || null : null,
        staffId: staffId || null,
        locationId: locationId || null,
        usePackCredit: usePackId || null,
        bookingDate,
        bookingTime,
        notes: notes || null,
      }),
    });

    const data = await res.json();
    if (data.error) {
      // Horario ocupado → ofrecer lista de espera (solo estética con turnera
      // por servicio: hay serviceId o catálogo).
      if (res.status === 409 && useCatalog) {
        setOverlap(true);
        setLoading(false);
        return;
      }
      setError(data.error);
      setLoading(false);
      return;
    }

    if (data.packUsed) {
      setPackMsg(`✅ Se usó 1 sesión de ${data.packUsed.pack_name} (quedan ${data.packUsed.remaining}).`);
    } else if (data.packWarning) {
      setPackMsg(`⚠️ ${data.packWarning}`);
    }
    if (data.depositRequired) {
      if (data.depositInitPoint) {
        setDepositPayUrl(String(data.depositInitPoint));
      } else {
        setDepositMsg(data.depositWarning || "Este servicio exige seña: coordiná el pago por WhatsApp.");
      }
    }
    setDone(true);
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="b-name">Tu nombre</Label>
        <Input id="b-name" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre y apellido" required />
      </div>
      <div>
        <Label htmlFor="b-phone">Tu WhatsApp</Label>
        <Input id="b-phone" value={phone} onChange={e => setPhone(e.target.value)} onBlur={e => { if (useCatalog) lookupCredits(e.target.value); }} placeholder="221 555 0000" required />
      </div>
      {useCatalog && (creditsLoading ? (
        <p className="text-xs text-muted-foreground">Buscando tus sesiones...</p>
      ) : credits.length > 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 space-y-2">
          <Label htmlFor="b-pack">🎟️ Tenés sesiones disponibles</Label>
          <select
            id="b-pack"
            value={usePackId}
            onChange={e => setUsePackId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Pagar normal (no usar sesión)</option>
            {credits.map(c => (
              <option key={c.pack_id} value={c.pack_id}>Usar 1 de {c.pack_name} ({c.remaining} restantes)</option>
            ))}
          </select>
        </div>
      ) : null)}
      {useCatalog ? (
        <div>
          <Label htmlFor="b-service">Servicio *</Label>
          <select
            id="b-service"
            value={serviceId}
            onChange={e => setServiceId(e.target.value)}
            required
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Seleccionar servicio</option>
            {serviceOptions.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}{s.duration_min ? ` · ${s.duration_min} min` : ""}{s.price != null ? ` · $${Number(s.price).toLocaleString("es-AR")}` : ""}{s.deposit_amount ? ` · seña $${Number(s.deposit_amount).toLocaleString("es-AR")}` : ""}
              </option>
            ))}
          </select>
          {chosenService?.deposit_amount ? (
            <p className="text-xs text-muted-foreground mt-1">
              💰 Este servicio pide una seña de ${Number(chosenService.deposit_amount).toLocaleString("es-AR")} para confirmar (te la descuentan el día del turno).
              {chosenService.require_deposit ? " 🔒 Sin la seña el turno se libera." : ""}
            </p>
          ) : null}
        </div>
      ) : services && services.length > 0 && (
        <div>
          <Label htmlFor="b-service">Servicio</Label>
          <select
            id="b-service"
            value={productName}
            onChange={e => setProductName(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Seleccionar servicio</option>
            {services.map(s => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>
      )}
      {locationOptions && locationOptions.length > 0 && (
        <div>
          <Label htmlFor="b-location">Sede</Label>
          <select
            id="b-location"
            value={locationId}
            onChange={e => setLocationId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Sin preferencia</option>
            {locationOptions.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.address ? ` · ${s.address}` : ""}</option>
            ))}
          </select>
        </div>
      )}
      {staffOptions && staffOptions.length > 0 && (
        <div>
          <Label htmlFor="b-staff">Profesional (opcional)</Label>
          <select
            id="b-staff"
            value={staffId}
            onChange={e => setStaffId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Sin preferencia</option>
            {staffOptions.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="b-date">Fecha *</Label>
          <Input id="b-date" type="date" value={bookingDate} onChange={e => setBookingDate(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="b-time">Horario *</Label>
          <TimeSelect24 value={bookingTime} onChange={setBookingTime} aria-label="Horario" />
        </div>
      </div>
      {useSlots && (
        <div>
          <Label>Huecos disponibles{slotsLoading ? " (cargando...)" : ""}</Label>
          {slotsClosed ? (
            <p className="text-xs text-muted-foreground mt-1">Cerrado ese día. Probá otra fecha.</p>
          ) : slots.length === 0 && !slotsLoading ? (
            <p className="text-xs text-muted-foreground mt-1">Elegí la hora abajo.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {slots.map((s) => (
                <button
                  key={s.time}
                  type="button"
                  disabled={!s.available}
                  onClick={() => setBookingTime(s.time)}
                  className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                    bookingTime === s.time
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : s.available
                        ? "border-border text-muted-foreground"
                        : "border-border text-muted-foreground/40 line-through"
                  }`}
                >
                  {s.time}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div>
        <Label htmlFor="b-notes">Notas (opcional)</Label>
        <Textarea id="b-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Alguna indicación extra..." rows={2} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {overlap && !waitDone && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2">
          <p className="text-xs font-medium text-amber-900">
            😕 Ese horario ya está ocupado. ¿Te avisamos si se libera?
          </p>
          <Button type="button" size="sm" className="w-full" disabled={waitBusy} onClick={joinWaitlist}>
            {waitBusy ? "Anotando..." : "🔔 Avisame si se libera"}
          </Button>
        </div>
      )}
      {waitDone && (
        <p className="text-xs rounded-lg bg-green-50 border border-green-200 text-green-800 px-3 py-2">
          ✅ Anotada en lista de espera. Si se libera, te escribimos.
        </p>
      )}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Reservando..." : "Reservar turno"}
      </Button>
      {cancelPolicy && (
        <p className="text-xs text-muted-foreground text-center">
          📝 {cancelPolicy}
        </p>
      )}
      <p className="text-xs text-muted-foreground text-center">
        {vendorName} te va a confirmar la disponibilidad por WhatsApp.
      </p>
    </form>
  );
}
