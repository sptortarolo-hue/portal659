"use client";

import { useState } from "react";
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
  serviceOptions?: { id: string; name: string; deposit_amount: number | null; duration_min: number | null; price?: number | null }[];
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
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const useCatalog = !!serviceOptions && serviceOptions.length > 0;
  const chosenService = useCatalog ? serviceOptions.find((s) => s.id === serviceId) : undefined;

  if (done) {
    return (
      <div className="text-center py-6">
        <p className="text-2xl mb-2">📅</p>
        <p className="font-medium">Turno reservado</p>
        <p className="text-sm text-muted-foreground mt-1">
          {bookingDate} a las {bookingTime}. {vendorName} te va a confirmar.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone || !bookingDate || !bookingTime) return;
    setLoading(true);
    setError("");

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
        bookingDate,
        bookingTime,
        notes: notes || null,
      }),
    });

    const data = await res.json();
    if (data.error) {
      setError(data.error);
      setLoading(false);
      return;
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
        <Input id="b-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="221 555 0000" required />
      </div>
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
      <div>
        <Label htmlFor="b-notes">Notas (opcional)</Label>
        <Textarea id="b-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Alguna indicación extra..." rows={2} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
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
