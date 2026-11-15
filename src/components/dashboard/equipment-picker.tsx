"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhotoPicker } from "@/components/ui/photo-picker";
import type { Equipment, EquipmentKind } from "@/lib/equipment";
import {
  EQUIPMENT_KINDS,
  equipmentAttrLabel,
  equipmentEmoji,
  equipmentFieldExamples,
  equipmentKindLabel,
  equipmentLabel,
  inferEquipmentKind,
} from "@/lib/equipment";

type Props = {
  /** Teléfono que ya cargó el comercio (o el cliente en el micrositio). */
  phone: string;
  customerName?: string;
  value: Equipment | null;
  onChange: (eq: Equipment | null) => void;
};

/**
 * Picker de equipo (bici/moto/auto/electro/celular/PC) para el turno o
 * presupuesto manual: elegir un equipo ya cargado del cliente o crear uno
 * nuevo al vuelo (con selector de tipo y default por rubro del comercio).
 * Si el comercio no aplicó la migración `migrate-equipment.sql`, se muestra
 * el aviso y se sigue sin equipo (el resto funciona igual).
 */
export function EquipmentPicker({ phone, customerName, value, onChange }: Props) {
  const [items, setItems] = useState<Equipment[]>([]);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [rodado, setRodado] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [color, setColor] = useState("");
  const [notes, setNotes] = useState("");
  // Tipo de equipo: default inteligente por rubro del comercio (una
  // bicicletería crea bicis; el resto ya no nace bici). Si el usuario lo
  // toca a mano, se respeta su elección. El selector arranca colapsado
  // (una línea "Tipo: X · cambiar") salvo que el rubro sea ambiguo.
  const [kind, setKind] = useState<EquipmentKind>("otro");
  const [kindTouched, setKindTouched] = useState(false);
  const [tipoAbierto, setTipoAbierto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoMsg, setPhotoMsg] = useState("");

  async function uploadPhoto(file: File) {
    if (!value) return;
    setPhotoBusy(true);
    setPhotoMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/vendor/upload", { method: "POST", body: fd });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok || upData.error) throw new Error(upData.error || "No se pudo subir la foto");
      const url = String(upData.url || "").trim();
      const patch = await fetch(`/api/vendor/equipment/${value.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_url: url }),
      });
      const patchData = await patch.json().catch(() => ({}));
      if (!patch.ok || patchData.error) throw new Error(patchData.error || "No se pudo guardar la foto");
      onChange({ ...value, photo_url: url });
      setItems((prev) => prev.map((i) => (i.id === value.id ? { ...i, photo_url: url } : i)));
      setPhotoMsg("Foto guardada ✅");
    } catch (e) {
      setPhotoMsg(e instanceof Error ? e.message : "No se pudo subir la foto");
    } finally {
      setPhotoBusy(false);
    }
  }

  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8 || value) {
      if (!value) setItems([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/vendor/equipment?phone=${encodeURIComponent(digits)}`);
        if (!res.ok) return;
        const d = await res.json();
        setMigrationMissing(!!d?.migrationMissing);
        setItems(Array.isArray(d?.equipment) ? d.equipment : []);
      } catch {
        /* silencio: se puede crear igual */
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [phone, value]);

  // Tipo por default según el rubro del comercio (se pisa si el usuario eligió).
  // Rubro ambiguo (no matchea ningún tipo conocido) → selector abierto: ahí sí
  // hacen falta las opciones a la vista.
  useEffect(() => {
    if (kindTouched) return;
    let cancelled = false;
    fetch("/api/vendor/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.vendor?.category) return;
        const inferred = inferEquipmentKind(d.vendor.category);
        setKind(inferred);
        if (inferred === "otro") setTipoAbierto(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kindTouched]);

  // Ejemplos de marca/modelo según el tipo elegido (evita "Scott" en un
  // service de celulares o PC).
  const eg = equipmentFieldExamples(kind);

  async function create() {
    setError("");
    if (!brand.trim() && !model.trim() && !identifier.trim() && !rodado.trim() && !color.trim()) {
      setError("Cargá al menos marca/modelo o N° de serie");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/vendor/equipment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName || null,
          customer_phone: phone,
          kind,
          brand,
          model,
          identifier,
          rodado,
          color,
          notes,
        }),
      });
      const d = await res.json();
      if (res.status === 503) { setMigrationMissing(true); setError(d?.error || "Falta la migración"); return; }
      if (!res.ok || d?.error) throw new Error(d?.error || "No se pudo guardar");
      onChange(d.equipment as Equipment);
      setBrand(""); setModel(""); setRodado(""); setIdentifier(""); setColor(""); setNotes("");
      setItems((prev) => [d.equipment as Equipment, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div className="rounded-xl border border-border p-2.5 space-y-2 bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-sm flex-1 min-w-0 truncate">
            {equipmentEmoji(value.kind)} {equipmentLabel(value)}
          </span>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => onChange(null)}>
            Quitar
          </button>
        </div>
        {value.photo_url && (
          <img
            src={value.photo_url}
            alt="Foto de recepción del equipo"
            className="max-h-32 w-full rounded-lg object-cover"
          />
        )}
        <div className="flex items-center gap-2">
          <PhotoPicker
            disabled={photoBusy}
            cameraLabel={photoBusy ? "Subiendo..." : value.photo_url ? "📷 Cambiar foto" : "📷 Agregar foto"}
            galleryLabel={photoBusy ? "Subiendo..." : "🖼️ Galería"}
            onFile={(f) => { if (f) void uploadPhoto(f); }}
          />
          <span className="text-[10px] text-muted-foreground">Condición al ingreso</span>
          {photoMsg && <span className="text-[10px] text-muted-foreground">{photoMsg}</span>}
        </div>
      </div>
    );
  }

  const showPick = !migrationMissing && items.length > 0 && mode === "pick";

  return (
    <div className="rounded-xl border border-dashed border-border p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">{equipmentEmoji(kind)} Equipo (opcional)</Label>
        {!migrationMissing && (
          <div className="flex gap-1">
            <button type="button" onClick={() => setMode("pick")} className={`px-2 h-6 rounded-md text-[11px] font-medium ${mode === "pick" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>Elegir</button>
            <button type="button" onClick={() => setMode("new")} className={`px-2 h-6 rounded-md text-[11px] font-medium ${mode === "new" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>+ Nuevo</button>
          </div>
        )}
      </div>
      {migrationMissing ? (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          Aplicá <code>migrate-equipment.sql</code> en la base para registrar equipos del taller.
        </p>
      ) : showPick ? (
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value=""
          onChange={(e) => {
            const eq = items.find((i) => i.id === e.target.value);
            if (eq) onChange(eq);
          }}
        >
          <option value="">Elegir equipo del cliente… ({items.length})</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {equipmentEmoji(i.kind)} {(i.brand || equipmentKindLabel(i.kind)) + (i.model ? ` ${i.model}` : "")}{i.rodado ? ` · ${i.rodado}` : ""}{i.identifier ? ` · N° ${i.identifier}` : ""}
            </option>
          ))}
        </select>
      ) : (
        <div className="space-y-1.5">
          {tipoAbierto ? (
            <div className="flex flex-wrap gap-1">
              {EQUIPMENT_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => { setKind(k); setKindTouched(true); setTipoAbierto(false); }}
                  className={`px-2 h-6 rounded-md text-[11px] font-medium ${kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground border border-border"}`}
                >
                  {equipmentEmoji(k)} {equipmentKindLabel(k)}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setTipoAbierto(true)}
              className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {equipmentEmoji(kind)} Tipo: {equipmentKindLabel(kind)}
              <span className="underline">cambiar</span>
            </button>
          )}
        <div className="grid grid-cols-2 gap-1.5">
          <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder={`Marca (ej: ${eg.brand})`} className="h-8 text-xs" />
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder={`Modelo (ej: ${eg.model})`} className="h-8 text-xs" />
          <Input value={rodado} onChange={(e) => setRodado(e.target.value)} placeholder={`${equipmentAttrLabel(kind)} (ej: ${kind === "automotor" ? "AB123CD" : kind === "moto" ? "150cc" : kind === "bici" ? "29" : "7 kg"})`} className="h-8 text-xs" />
          <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder={kind === "automotor" ? "N° de motor / VIN" : "N° de cuadro / serie"} className="h-8 text-xs" />
          <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Color" className="h-8 text-xs" />
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas" className="h-8 text-xs" />
          {error && <p className="text-[11px] text-red-600 col-span-2">{error}</p>}
          </div>
          <Button type="button" size="sm" className="h-8 text-xs w-full" disabled={busy} onClick={create}>
            {busy ? "Guardando…" : "Guardar equipo"}
          </Button>
        </div>
      )}
    </div>
  );
}
