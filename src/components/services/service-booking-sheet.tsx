"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/product-image";
import { BookingForm } from "@/components/services/booking-form";

export type EsteticaServiceCard = {
  id: string;
  name: string;
  deposit_amount: number | null;
  duration_min: number | null;
  price: number | null;
  require_deposit: boolean | null;
  deposit_hours: number | null;
  image_url: string | null;
  category: string | null;
  description: string | null;
};

/**
 * Carta visual estilo moda: tarjetas grandes con foto. Al tocar se abre el
 * detalle (sheet) y de ahí se solicita el turno. Patrón Fresha/Booksy.
 */
export function ServiceCards({
  services,
  onPick,
}: {
  services: EsteticaServiceCard[];
  onPick: (service: EsteticaServiceCard) => void;
}) {
  if (services.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {services.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s)}
          className="flex flex-col rounded-xl overflow-hidden border border-border bg-card text-left shadow-sm hover:shadow-md transition-shadow"
        >
          <span className="relative w-full aspect-square overflow-hidden bg-accent/60">
            <ProductImage
              src={s.image_url}
              name={s.name}
              vertical="estetica"
              alt={s.name}
              className="w-full h-full object-cover"
            />
            {s.require_deposit === true && s.deposit_amount != null && Number(s.deposit_amount) > 0 && (
              <span className="absolute top-2 left-2 rounded-full bg-black/60 text-white px-2 py-0.5 text-[10px] font-semibold">
                🔒 Con seña
              </span>
            )}
          </span>
          <span className="p-2.5 flex flex-col gap-0.5">
            <span className="text-[13px] font-medium line-clamp-1">{s.name}</span>
            <span className="text-xs text-muted-foreground">
              {[s.duration_min != null && Number(s.duration_min) > 0 ? `${s.duration_min} min` : null,
                s.price != null && Number(s.price) >= 0 ? `$${Number(s.price).toLocaleString("es-AR")}` : null]
                .filter(Boolean)
                .join(" · ") || "Consultar"}
            </span>
            <span className="text-xs font-semibold text-primary mt-0.5">Ver detalle →</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Sección de carta por rubro para el micrositio: agrupa por categoría,
 * muestra tarjetas grandes y abre el sheet de detalle/reserva.
 */
export function EsteticaServicesSection({
  services,
  vendorId,
  vendorName,
  staffOptions,
  locationOptions,
  cancelPolicy,
}: {
  services: EsteticaServiceCard[];
  vendorId: string;
  vendorName: string;
  staffOptions?: { id: string; name: string }[];
  locationOptions?: { id: string; name: string; address?: string | null }[];
  cancelPolicy?: string | null;
}) {
  const [picked, setPicked] = useState<EsteticaServiceCard | null>(null);
  if (services.length === 0) return null;
  const groups: { name: string | null; items: EsteticaServiceCard[] }[] = [];
  for (const s of services) {
    const g = groups.find((x) => (x.name || "") === (s.category || ""));
    if (g) g.items.push(s);
    else groups.push({ name: s.category, items: [s] });
  }
  const serviceOptions = services.map((s) => ({
    id: s.id,
    name: s.name,
    deposit_amount: s.deposit_amount,
    duration_min: s.duration_min,
    price: s.price,
    require_deposit: s.require_deposit,
    deposit_hours: s.deposit_hours,
  }));
  return (
    <div className="mb-5 space-y-5">
      {groups.map((g) => (
        <div key={g.name || "servicios"}>
          {g.name && (
            <h4 className="font-display text-base font-semibold mb-2">{g.name}</h4>
          )}
          <ServiceCards services={g.items} onPick={setPicked} />
        </div>
      ))}
      {picked && (
        <ServiceBookingSheet
          service={picked}
          vendorId={vendorId}
          vendorName={vendorName}
          serviceOptions={serviceOptions}
          staffOptions={staffOptions}
          locationOptions={locationOptions}
          cancelPolicy={cancelPolicy}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  );
}
export function ServiceBookingSheet({
  service,
  vendorId,
  vendorName,
  serviceOptions,
  staffOptions,
  locationOptions,
  cancelPolicy,
  onClose,
}: {
  service: EsteticaServiceCard;
  vendorId: string;
  vendorName: string;
  serviceOptions?: { id: string; name: string; deposit_amount: number | null; duration_min: number | null; price?: number | null; require_deposit?: boolean | null; deposit_hours?: number | null }[];
  staffOptions?: { id: string; name: string }[];
  locationOptions?: { id: string; name: string; address?: string | null }[];
  cancelPolicy?: string | null;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"detail" | "book">("detail");
  // Foto ampliada (como la galería de gastro): overlay propio sobre el sheet.
  const [photoOpen, setPhotoOpen] = useState(false);

  // Preselecciona el servicio en el formulario al pasar al paso de reserva
  // (mismo evento que usaba el botón "Elegir").
  useEffect(() => {
    if (step !== "book") return;
    window.dispatchEvent(
      new CustomEvent("portal:pick-service", { detail: { serviceId: service.id } })
    );
  }, [step, service.id]);

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card w-full sm:max-w-md sm:mx-4 max-h-[92vh] sm:max-h-[85vh] flex flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-border">
        <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-border bg-card">
          {step === "book" && (
            <button
              type="button"
              onClick={() => setStep("detail")}
              className="text-sm text-muted-foreground hover:text-foreground"
              aria-label="Volver al detalle"
            >
              ‹ Volver
            </button>
          )}
          <p className="font-semibold text-sm truncate flex-1">{service.name}</p>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none px-1"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        {photoOpen && service.image_url && (
          <div
            className="fixed inset-0 z-[90] bg-black/85 flex flex-col"
            onClick={() => setPhotoOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label={`Foto de ${service.name}`}
          >
            <div className="flex items-center justify-end px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] text-white">
              <button
                type="button"
                onClick={() => setPhotoOpen(false)}
                aria-label="Cerrar"
                className="h-11 w-11 rounded-full bg-white/10 flex items-center justify-center text-xl"
              >
                ✕
              </button>
            </div>
            <div
              className="flex-1 min-h-0 min-w-0 flex items-center justify-center p-4"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Relleno con blur de la misma foto (fondo) + imagen nítida contenida */}
              {/* Marco 9:16 vertical: alto manda (75vh), ancho por aspect, con tope */}
              <div className="relative h-[75vh] aspect-[9/16] max-w-[calc(100vw-2rem)] rounded-lg overflow-hidden">
                <ProductImage
                  src={service.image_url}
                  name={service.name}
                  vertical="estetica"
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover blur-2xl brightness-50 scale-110"
                />
                <ProductImage
                  src={service.image_url}
                  name={service.name}
                  vertical="estetica"
                  alt={service.name}
                  className="relative w-full h-full object-contain"
                />
              </div>
            </div>
            <p className="text-center text-white text-sm pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] px-4 truncate">
              {service.name}
            </p>
          </div>
        )}
        <div className="overflow-y-auto">
          {step === "detail" ? (
            <div>
              {service.image_url ? (
                <button
                  type="button"
                  onClick={() => setPhotoOpen(true)}
                  className="relative block w-full aspect-[4/3] overflow-hidden bg-accent/60"
                  aria-label={`Ampliar foto de ${service.name}`}
                >
                  <ProductImage
                    src={service.image_url}
                    name={service.name}
                    vertical="estetica"
                    alt={service.name}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-2 right-2 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center" aria-hidden="true">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M10 18a8 8 0 100-16 8 8 0 000 16zm1-11v6m-3-3h6" />
                    </svg>
                  </span>
                </button>
              ) : (
                <div className="w-full aspect-[4/3] bg-accent/60" />
              )}
              <div className="p-4 space-y-3">
                {service.category && (
                  <p className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">
                    {service.category}
                  </p>
                )}
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  {service.duration_min != null && Number(service.duration_min) > 0 && (
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                      ⏱️ {service.duration_min} min
                    </span>
                  )}
                  {service.price != null && Number(service.price) >= 0 && (
                    <span className="font-display font-bold text-lg">
                      ${Number(service.price).toLocaleString("es-AR")}
                    </span>
                  )}
                </div>
                {service.description && (
                  <p className="text-sm text-muted-foreground whitespace-pre-line">{service.description}</p>
                )}
                {service.require_deposit === true && service.deposit_amount != null && Number(service.deposit_amount) > 0 && (
                  <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2">
                    🔒 Este servicio exige seña de ${Number(service.deposit_amount).toLocaleString("es-AR")}
                    {service.deposit_hours != null && Number(service.deposit_hours) > 0 ? ` (a pagar dentro de ${service.deposit_hours}h)` : ""} para confirmar.
                  </p>
                )}
                {cancelPolicy && (
                  <p className="text-xs text-muted-foreground">📋 {cancelPolicy}</p>
                )}
                <Button className="w-full" size="lg" onClick={() => setStep("book")}>
                  Solicitar turno →
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <BookingForm
                key={service.id}
                vendorId={vendorId}
                vendorName={vendorName}
                serviceOptions={serviceOptions}
                staffOptions={staffOptions}
                locationOptions={locationOptions}
                cancelPolicy={cancelPolicy}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
