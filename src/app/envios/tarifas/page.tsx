"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ZoneRow = {
  zoneId: string;
  zoneName: string;
  description: string | null;
  price: number;
  etaDays: number | null;
  active: boolean;
  carrierId: string;
  carrierName: string;
  fee: number | null;
};

export default function MisTarifasPage() {
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [carrierNames, setCarrierNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/carrier/rates");
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setError("Iniciá sesión con tu cuenta de operador.");
        return;
      }
      if (!res.ok) {
        setError(j.error || "No se pudieron cargar las tarifas");
        return;
      }
      const list: ZoneRow[] = Array.isArray(j.zones) ? j.zones : [];
      setZones(list);
      setCarrierNames((j.carriers || []).map((c: { name: string }) => c.name));
      setDraft(
        Object.fromEntries(list.map((z) => [z.zoneId, z.fee != null ? String(z.fee) : ""]))
      );
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(z: ZoneRow) {
    const raw = draft[z.zoneId] ?? "";
    const fee = raw.trim() === "" ? 0 : Number(raw);
    if (!Number.isFinite(fee) || fee < 0) {
      setError("Revisá el monto de la tarifa");
      return;
    }
    setSaving(z.zoneId);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/carrier/rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zoneId: z.zoneId, fee }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "No se pudo guardar");
        return;
      }
      setMsg(`Tarifa de ${z.zoneName} guardada ✅`);
      await load();
    } catch {
      setError("Error de red");
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">💲 Mis tarifas</h1>
            <p className="text-xs text-muted-foreground">
              {carrierNames.length ? carrierNames.join(" · ") : "Logística"} · cuánto le cobrás al local por zona
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

        <div className="rounded-xl border border-border bg-background px-3 py-2.5 text-[11px] text-muted-foreground space-y-1">
          <p>El precio de venta al comprador lo define el portal y el local; esta tarifa es <b>lo que te paga el local al retirar el paquete</b>.</p>
          <p>Se congela en cada encargo al avisar: cambiar una tarifa no modifica los envíos ya creados.</p>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : zones.length === 0 ? (
          <div className="rounded-xl border border-border bg-background p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Todavía no tenés zonas asignadas. El equipo de Portal 659 las carga desde el panel de administración.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {zones.map((z) => (
              <div key={z.zoneId} className="rounded-xl border border-border bg-background p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-tight">{z.zoneName}</p>
                    {z.description && <p className="text-[11px] text-muted-foreground">{z.description}</p>}
                  </div>
                  <span className="text-[10px] rounded-full border border-border bg-muted px-2 py-0.5 whitespace-nowrap text-muted-foreground">
                    {z.active ? "Activa" : "Pausada"}
                    {z.etaDays != null ? ` · ${z.etaDays} d` : ""}
                  </span>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Mi tarifa por envío ($)
                    </label>
                    <Input
                      className="h-9 text-sm mt-0.5"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={draft[z.zoneId] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [z.zoneId]: e.target.value }))}
                      placeholder="0"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="h-9"
                    disabled={saving === z.zoneId}
                    onClick={() => save(z)}
                  >
                    {saving === z.zoneId ? "..." : "Guardar"}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  El comprador paga ${Math.round(z.price).toLocaleString("es-AR")} de envío en el checkout (precio del catálogo).
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
