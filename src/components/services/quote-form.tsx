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
  servicesList?: string | null;
};

export function QuoteForm({ vendorId, vendorName, servicesList }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [description, setDescription] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (done) {
    return (
      <div className="text-center py-6">
        <p className="text-2xl mb-2">✅</p>
        <p className="font-medium">Presupuesto enviado</p>
        <p className="text-sm text-muted-foreground mt-1">
          {vendorName} te va a responder pronto.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone || !description) return;
    setLoading(true);
    setError("");

    // Fotos del problema (opcional, hasta 3). Se suben antes de la solicitud.
    let photoUrls: string[] = [];
    if (photos.length > 0) {
      try {
        const fd = new FormData();
        photos.slice(0, 3).forEach((f) => fd.append("files", f));
        const upRes = await fetch(`/api/service-upload?vendorId=${vendorId}`, {
          method: "POST",
          body: fd,
        });
        const upData = await upRes.json();
        if (!upRes.ok || !upData.urls) throw new Error(upData.error || "No se pudieron subir las fotos");
        photoUrls = upData.urls;
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudieron subir las fotos");
        setLoading(false);
        return;
      }
    }

    const res = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId,
        customerName: name,
        customerPhone: phone,
        serviceName: serviceName || null,
        description,
        preferredDate: preferredDate || null,
        preferredTime: preferredTime || null,
        photoUrls,
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
        <Label htmlFor="q-name">Tu nombre</Label>
        <Input id="q-name" value={name} onChange={e => setName(e.target.value)} placeholder="Nombre y apellido" required />
      </div>
      <div>
        <Label htmlFor="q-phone">Tu WhatsApp</Label>
        <Input id="q-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="221 555 0000" required />
      </div>
      {servicesList && (
        <div>
          <Label htmlFor="q-service">Servicio que necesitás</Label>
          <Input id="q-service" value={serviceName} onChange={e => setServiceName(e.target.value)} placeholder={servicesList} />
        </div>
      )}
      <div>
        <Label htmlFor="q-desc">Describí lo que necesitás *</Label>
        <Textarea id="q-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="Contanos brevemente qué necesitás, medidas, cantidades, etc." required rows={3} />
      </div>
      <div>
        <Label htmlFor="q-photos">Fotos del problema (opcional, hasta 3)</Label>
        <Input
          id="q-photos"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={(e) => setPhotos(Array.from(e.target.files || []).slice(0, 3))}
        />
        {photos.length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">{photos.length} foto{photos.length > 1 ? "s" : ""} seleccionada{photos.length > 1 ? "s" : ""}</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="q-date">Fecha preferida</Label>
          <Input id="q-date" type="date" value={preferredDate} onChange={e => setPreferredDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="q-time">Horario preferido</Label>
          <TimeSelect24 value={preferredTime} onChange={setPreferredTime} aria-label="Horario preferido" />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Enviando..." : "Solicitar presupuesto"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Sin compromiso. {vendorName} te responde por WhatsApp.
      </p>
    </form>
  );
}
