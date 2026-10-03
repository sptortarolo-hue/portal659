"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DAY_LABELS: Record<string, string> = {
  lun: "Lun", mar: "Mar", mie: "Mié", jue: "Jue", vie: "Vie", sab: "Sáb", dom: "Dom",
};
const DEFAULT_DAYS = ["lun", "mar", "mie", "jue", "vie", "sab"];
const DEFAULT_SLOTS = ["mañana", "tarde"];

type Props = {
  vendorId: string;
  vendorName: string;
  servicesList?: string | null;
  /** Bloque de preferencias visible (configurable por comercio). */
  prefEnabled?: boolean;
  /** Días ofrecidos (ids). Default Lun–Sáb. */
  prefDays?: string[];
  /** Franjas ofrecidas. Default mañana/tarde. */
  prefSlots?: string[];
  /** Copy de estética ("consulta" en vez de "presupuesto"). */
  estetica?: boolean;
};

export function QuoteForm({ vendorId, vendorName, servicesList, prefEnabled = true, prefDays, prefSlots, estetica = false }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [description, setDescription] = useState("");
  const [prefDayList, setPrefDayList] = useState<string[]>([]);
  const [prefSlot, setPrefSlot] = useState("");
  const days = (prefDays && prefDays.length > 0 ? prefDays : DEFAULT_DAYS).filter((d) => DAY_LABELS[d]);
  const slots = prefSlots && prefSlots.length > 0 ? prefSlots : DEFAULT_SLOTS;
  const [photos, setPhotos] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  if (done) {
    return (
      <div className="text-center py-6">
        <p className="text-2xl mb-2">✅</p>
        <p className="font-medium">{estetica ? "Consulta enviada" : "Presupuesto enviado"}</p>
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
        preferredDate: prefDayList.length > 0
          ? prefDayList.map((d) => DAY_LABELS[d] || d).join(", ")
          : null,
        preferredTime: prefSlot || null,
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
      {prefEnabled && days.length > 0 && (
        <div>
          <Label>Días preferidos</Label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {days.map((d) => {
              const active = prefDayList.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setPrefDayList((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))}
                  className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${active ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"}`}
                >
                  {DAY_LABELS[d]}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {prefEnabled && slots.length > 0 && (
        <div>
          <Label>Horario preferido</Label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {slots.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setPrefSlot((prev) => (prev === s ? "" : s))}
                className={`px-3 py-1.5 rounded-full border text-sm capitalize transition-colors ${prefSlot === s ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Enviando..." : estetica ? "Enviar consulta" : "Solicitar presupuesto"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Sin compromiso. {vendorName} te responde por WhatsApp.
      </p>
    </form>
  );
}
