"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ZoneRow = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  carrierFee: number | null;
  etaDays: number | null;
  active: boolean;
  carrierId: string;
  carrierName: string;
  position: number;
};

export default function MisZonasPage() {
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [carrierNames, setCarrierNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  // Form de alta.
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [eta, setEta] = useState("2");
  const [carrierId, setCarrierId] = useState("");

  const [draft, setDraft] = useState<Record<string, { name: string; price: string; fee: string; eta: string; active: boolean }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/carrier/zones");
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setError("Iniciá sesión con tu cuenta de operador.");
        return;
      }
      if (!res.ok) {
        setError(j.error || "No se pudieron cargar las zonas");
        return;
      }
      const list: ZoneRow[] = Array.isArray(j.zones) ? j.zones : [];
      setZones(list);
      setCarrierNames((j.carriers || []).map((c: { name: string }) => c.name));
      if (!carrierId && j.carriers?.length) setCarrierId(j.carriers[0].id);
      setDraft(
        Object.fromEntries(
          list.map((z) => [
            z.id,
            { name: z.name, price: String(z.price), fee: z.carrierFee != null ? String(z.carrierFee) : "", eta: z.etaDays != null ? String(z.etaDays) : "2", active: z.active },
          ])
        )
      );
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }, [carrierId]);

  useEffect(() => {
    load();
  }, [load]);

  async function createZone() {
    if (!name.trim() || !Number(price)) {
      setError("Faltan el nombre y el precio de la zona");
      return;
    }
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/carrier/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: desc.trim() || undefined,
          price: Number(price),
          carrierFee: fee.trim() ? Number(fee) : undefined,
          etaDays: Number(eta),
          carrierId,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "No se pudo crear la zona");
        return;
      }
      setMsg("Zona creada ✅");
      setName("");
      setDesc("");
      setPrice("");
      setFee("");
      setEta("2");
      await load();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function saveZone(z: ZoneRow) {
    const d = draft[z.id];
    if (!d) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/carrier/zones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: z.id,
          name: d.name.trim() || z.name,
          price: Number(d.price) || z.price,
          carrierFee: d.fee.trim() === "" ? null : Number(d.fee),
          etaDays: Number(d.eta) || z.etaDays || 2,
          active: d.active,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "No se pudo guardar");
        return;
      }
      setMsg(`Zona ${d.name || z.name} actualizada ✅`);
      await load();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function removeZone(z: ZoneRow) {
    if (!window.confirm(`¿Borrar/pausar "${z.name}"?`)) return;
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/carrier/zones", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: z.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "No se pudo borrar");
        return;
      }
      setMsg(j.soft ? "Zona pausada (tiene envíos en curso) ⏸️" : "Zona borrada ✅");
      await load();
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">🗺️ Mis zonas de cobertura</h1>
            <p className="text-xs text-muted-foreground">
              {carrierNames.length ? carrierNames.join(" · ") : "Logística"} · definí las zonas que cubrís y lo que le cobrás al local
            </p>
          </div>
          <Link href="/envios" className="text-xs text-muted-foreground hover:text-foreground">
            ← Mis envíos
          </Link>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>
        )}
        {msg && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{msg}</div>
        )}

        {/* Alta */}
        <div className="rounded-xl border border-border bg-background p-3 space-y-2">
          <p className="text-sm font-semibold">Nueva zona</p>
          <div className="grid grid-cols-2 gap-2">
            <Input className="h-9 text-sm" placeholder="Nombre (ej: City Bell)*" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            <Input className="h-9 text-sm" placeholder="Descripción (opcional)" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} />
            <Input className="h-9 text-sm" type="number" inputMode="decimal" placeholder="Precio al comprador $" value={price} onChange={(e) => setPrice(e.target.value)} />
            <Input className="h-9 text-sm" type="number" inputMode="decimal" placeholder="Mi tarifa al local $" value={fee} onChange={(e) => setFee(e.target.value)} />
            <Input className="h-9 text-sm" type="number" inputMode="numeric" placeholder="ETA días" value={eta} onChange={(e) => setEta(e.target.value)} />
            {carrierNames.length > 1 && (
              <select
                className="h-9 text-sm rounded-md border border-input bg-background px-2"
                value={carrierId}
                onChange={(e) => setCarrierId(e.target.value)}
              >
                {carrierNames.map((n, i) => (
                  <option key={i} value={carrierId}>{n}</option>
                ))}
              </select>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            El precio al comprador es lo que ve el local al optar en su configuración; tu tarifa es lo que te paga el local al retirar.
          </p>
          <Button size="sm" disabled={busy || !name.trim() || !Number(price)} onClick={createZone}>
            {busy ? "..." : "Crear zona"}
          </Button>
        </div>

        {/* Listado editable */}
        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : zones.length === 0 ? (
          <div className="rounded-xl border border-border bg-background p-6 text-center">
            <p className="text-sm text-muted-foreground">Todavía no tenés zonas cargadas.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Creá la primera arriba. El admin también puede asignarte zonas desde el panel.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {zones.map((z) => {
              const d = draft[z.id] || { name: z.name, price: String(z.price), fee: z.carrierFee != null ? String(z.carrierFee) : "", eta: z.etaDays != null ? String(z.etaDays) : "2", active: z.active };
              return (
                <div key={z.id} className="rounded-xl border border-border bg-background p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Input
                      className="h-9 text-sm font-bold"
                      value={d.name}
                      onChange={(e) => setDraft((dd) => ({ ...dd, [z.id]: { ...d, name: e.target.value } }))}
                      maxLength={120}
                    />
                    <label className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={d.active}
                        onChange={(e) => setDraft((dd) => ({ ...dd, [z.id]: { ...d, active: e.target.checked } }))}
                      />
                      Activa
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Precio comprador $</label>
                      <Input className="h-8 text-xs mt-0.5" type="number" inputMode="decimal" value={d.price} onChange={(e) => setDraft((dd) => ({ ...dd, [z.id]: { ...d, price: e.target.value } }))} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Mi tarifa $</label>
                      <Input className="h-8 text-xs mt-0.5" type="number" inputMode="decimal" value={d.fee} onChange={(e) => setDraft((dd) => ({ ...dd, [z.id]: { ...d, fee: e.target.value } }))} placeholder="0" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">ETA días</label>
                      <Input className="h-8 text-xs mt-0.5" type="number" inputMode="numeric" value={d.eta} onChange={(e) => setDraft((dd) => ({ ...dd, [z.id]: { ...d, eta: e.target.value } }))} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-8" disabled={busy} onClick={() => saveZone(z)}>
                      {busy ? "..." : "Guardar"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => removeZone(z)}>
                      {z.active ? "Pausar" : "Borrar"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
