"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Equipment } from "@/lib/equipment";
import { equipmentLabel } from "@/lib/equipment";

type Props = {
  /** Teléfono que ya cargó el comercio (o el cliente en el micrositio). */
  phone: string;
  customerName?: string;
  value: Equipment | null;
  onChange: (eq: Equipment | null) => void;
};

/**
 * Picker de equipo (bici/moto/electro) para el turno o presupuesto manual:
 * elegir una bici ya cargada del cliente o crear una nueva al vuelo.
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
          <span className="text-sm flex-1 min-w-0 truncate">🚲 {equipmentLabel(value)}</span>
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
          <label className="cursor-pointer rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium hover:bg-muted">
            {photoBusy ? "Subiendo..." : value.photo_url ? "📷 Cambiar foto" : "📷 Agregar foto"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={photoBusy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadPhoto(f);
              }}
            />
          </label>
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
        <Label className="text-xs text-muted-foreground">🚲 Equipo (opcional)</Label>
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
              {(i.brand || "Equipo") + (i.model ? ` ${i.model}` : "")}{i.rodado ? ` · R${i.rodado}` : ""}{i.identifier ? ` · N° ${i.identifier}` : ""}
            </option>
          ))}
        </select>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marca (ej: Scott)" className="h-8 text-xs" />
          <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Modelo (ej: XT)" className="h-8 text-xs" />
          <Input value={rodado} onChange={(e) => setRodado(e.target.value)} placeholder="Rodado / medida" className="h-8 text-xs" />
          <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="N° de cuadro / serie" className="h-8 text-xs" />
          <Input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Color" className="h-8 text-xs" />
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas" className="h-8 text-xs" />
          <Button type="button" size="sm" className="h-8 text-xs col-span-2" disabled={busy} onClick={create}>
            {busy ? "Guardando…" : "Guardar equipo"}
          </Button>
          {error && <p className="text-[11px] text-red-600 col-span-2">{error}</p>}
        </div>
      )}
    </div>
  );
}
