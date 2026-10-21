"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Ficha de certificación de entrega (patrón Mercado Envíos Flex):
 * nombre de quien recibió + DNI (identidad por número, sin foto del documento
 * ni de la persona) + GPS del celular + foto del paquete en la puerta
 * (opcional). Compartida por el panel del operador (/envios) y la hoja sin
 * login del repartidor (/envio/[code]); cada página dice a qué endpoint sube
 * la foto y a qué API manda el resultado.
 */

type Props = {
  /** Sube la foto y devuelve la URL pública (o null si falla). */
  uploadEndpoint: (file: File) => Promise<string | null>;
  busy: boolean;
  onSubmit: (payload: {
    note: string;
    podPhotoUrl: string | null;
    deliveredToName: string;
    deliveredDni: string;
    deliveredLat: number;
    deliveredLng: number;
  }) => void;
  onCancel: () => void;
};

export function DeliverCertSheet({ uploadEndpoint, busy, onSubmit, onCancel }: Props) {
  const [name, setName] = useState("");
  const [dni, setDni] = useState("");
  const [note, setNote] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsMsg, setGpsMsg] = useState("");
  const [gpsBusy, setGpsBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoMsg, setPhotoMsg] = useState("");

  /** Captura del punto exacto del operativo (obligatorio al entregar). */
  function captureGps() {
    setGpsBusy(true);
    setGpsMsg("");
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setGpsMsg("Tu navegador no soporta ubicación: probá desde Chrome en el celular.");
      setGpsBusy(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) });
        setGpsMsg("📍 Ubicación capturada");
        setGpsBusy(false);
      },
      (err) => {
        setGps(null);
        setGpsMsg(
          err.code === 1
            ? "Permiso de ubicación denegado: habilitalo en el navegador para certificar la entrega."
            : "No pudimos leer el GPS. Verificá que la ubicación del celular esté activa y reintentá."
        );
        setGpsBusy(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 20000 }
    );
  }

  useEffect(() => {
    captureGps();
  }, []);

  async function uploadPhoto(file: File) {
    setPhotoMsg("");
    const url = await uploadEndpoint(file);
    if (url) {
      setPhotoUrl(url);
      setPhotoMsg("Foto cargada ✅");
    } else {
      setPhotoUrl(null);
      setPhotoMsg("No se pudo subir la foto (5 MB máx)");
    }
  }

  const valid = name.trim().length >= 3 && /^\d{7,9}$/.test(dni) && gps !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3" onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl bg-background p-4 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="text-sm font-bold">✅ Certifico la entrega</p>
          <p className="text-[11px] text-muted-foreground">Igual que Mercado Libre: identidad por DNI, sin foto del documento ni de la persona.</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">¿Quién recibió el paquete? *</label>
          <input
            className="w-full text-sm rounded-md border border-input bg-background px-2.5 py-2"
            placeholder="Nombre y apellido (puede no ser el comprador)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">DNI de quien recibió *</label>
          <input
            className="w-full text-sm rounded-md border border-input bg-background px-2.5 py-2"
            placeholder="Solo números, sin puntos"
            inputMode="numeric"
            value={dni}
            onChange={(e) => setDni(e.target.value.replace(/\D/g, "").slice(0, 9))}
          />
        </div>
        <div className="flex items-center gap-2">
          {gps ? (
            <span className="text-xs text-emerald-700">📍 GPS listo ({gps.lat}, {gps.lng})</span>
          ) : (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={gpsBusy} onClick={captureGps}>
                📍 Capturar ubicación
              </Button>
              {gpsMsg && <span className="text-[11px] text-amber-700">{gpsMsg}</span>}
            </>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium">Nota (opcional)</label>
          <input
            className="w-full text-sm rounded-md border border-input bg-background px-2.5 py-2"
            placeholder="Ej: firmó el portero / el paquete quedó en recepción"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={250}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs border border-input rounded-md px-2 py-1.5 cursor-pointer hover:bg-muted/50">
            {photoUrl ? "📷 Foto ✔" : "📷 Foto del paquete (opcional)"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadPhoto(f);
              }}
            />
          </label>
          {photoMsg && <span className="text-[11px] text-muted-foreground">{photoMsg}</span>}
        </div>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={onCancel}>Cancelar</Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={busy || !valid}
            onClick={() => {
              if (gps) {
                onSubmit({
                  note: note.trim(),
                  podPhotoUrl: photoUrl,
                  deliveredToName: name.trim(),
                  deliveredDni: dni,
                  deliveredLat: gps.lat,
                  deliveredLng: gps.lng,
                });
              }
            }}
          >
            Confirmar entrega
          </Button>
        </div>
        {!valid && (
          <p className="text-[11px] text-muted-foreground">
            Falta {name.trim().length < 3 ? "el nombre" : /^\d{7,9}$/.test(dni) ? "la ubicación GPS" : "el DNI"} para confirmar.
          </p>
        )}
      </div>
    </div>
  );
}
