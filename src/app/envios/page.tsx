"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Panel del operador de logística (Portal 659 Envíos v1): lista de encargos de
 * su carrier y avance de estados con nota + foto POD opcional. Acceso por
 * login normal del portal con rol de operador (carrier_operators).
 */

type ShipmentRow = {
  id: string;
  code: string;
  status: string;
  statusLabel: string;
  zoneName: string | null;
  requestedAt: string;
  storeName: string | null;
  storeAddress: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  items: { name: string; qty: number; price: number; combo_members?: { name: string; qty: number }[] }[];
  total: number;
};

type CarrierRow = { id: string; name: string };

type LoadData = {
  shipments: ShipmentRow[];
  carriers: CarrierRow[];
  ready: boolean;
};

const STATUS_ICON: Record<string, string> = {
  requested: "📋",
  picked_up: "📦",
  in_transit: "🚚",
  delivered: "✅",
  failed_attempt: "⚠️",
  returned: "↩️",
  cancelled: "❌",
};

const NEXT_STEPS: Record<string, { to: string; label: string }[]> = {
  requested: [
    { to: "picked_up", label: "📦 Colectado" },
    { to: "in_transit", label: "🚚 En camino" },
    { to: "returned", label: "↩️ Devuelto" },
    { to: "cancelled", label: "❌ Cancelar" },
  ],
  picked_up: [
    { to: "in_transit", label: "🚚 En camino" },
    { to: "delivered", label: "✅ Entregado" },
    { to: "failed_attempt", label: "⚠️ No entregado" },
    { to: "returned", label: "↩️ Devuelto" },
  ],
  in_transit: [
    { to: "delivered", label: "✅ Entregado" },
    { to: "failed_attempt", label: "⚠️ No entregado" },
  ],
  failed_attempt: [
    { to: "in_transit", label: "🚚 Reintentar" },
    { to: "delivered", label: "✅ Entregado" },
    { to: "returned", label: "↩️ Devuelto" },
    { to: "cancelled", label: "❌ Cancelar" },
  ],
};

const OPEN_STATUSES = new Set(["requested", "picked_up", "in_transit", "failed_attempt"]);

export default function EnviosOperadorPage() {
  const [data, setData] = useState<LoadData | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const [showNoteFor, setShowNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [podPhotos, setPodPhotos] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/shipments/operator");
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setError("Iniciá sesión en Portal 659 con tu cuenta de operador.");
        setData(null);
        return;
      }
      if (!res.ok) {
        setError(j.error || "Error al cargar");
        setData(null);
        return;
      }
      const shipments: ShipmentRow[] = Array.isArray(j?.shipments) ? j.shipments : [];
      setData({ shipments, carriers: Array.isArray(j?.carriers) ? j.carriers : [], ready: j.ready !== false });
      setError("");
    } catch {
      setError("Error de red");
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function moveShipment(s: ShipmentRow, to: string, note: string) {
    setBusyId(`${s.id}:${to}`);
    setRowMsg((m) => ({ ...m, [s.id]: "" }));
    try {
      const res = await fetch("/api/shipments/operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipmentId: s.id, status: to, note: note || undefined, podPhotoUrl: podPhotos[s.id] || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowMsg((m) => ({ ...m, [s.id]: j.error || "No se pudo actualizar" }));
      } else {
        setShowNoteFor(null);
        setNoteText("");
        await fetchData();
      }
    } catch {
      setRowMsg((m) => ({ ...m, [s.id]: "Error de red" }));
    } finally {
      setBusyId(null);
    }
  }

  async function uploadPod(shipmentId: string, file: File) {
    setRowMsg((m) => ({ ...m, [shipmentId]: "" }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/shipment-upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowMsg((m) => ({ ...m, [shipmentId]: j.error || "No se pudo subir la foto" }));
        return;
      }
      setPodPhotos((p) => ({ ...p, [shipmentId]: j.url }));
      setRowMsg((m) => ({ ...m, [shipmentId]: "📷 Foto cargada" }));
    } catch {
      setRowMsg((m) => ({ ...m, [shipmentId]: "Error de red al subir la foto" }));
    }
  }

  if (data && data.carriers.length === 0 && data.ready) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3 p-4 bg-background text-center">
        <p className="text-sm text-muted-foreground">
          Tu cuenta no está vinculada a una logística partner. Pedile al equipo de Portal 659 el alta como operador.
        </p>
        <Link href="/">
          <Button size="sm" variant="outline">← Ir a Portal 659</Button>
        </Link>
      </main>
    );
  }

  const open = (data?.shipments || []).filter((s) => OPEN_STATUSES.has(s.status));
  const closed = (data?.shipments || []).filter((s) => !OPEN_STATUSES.has(s.status)).slice(0, 30);

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold">🚚 Portal 659 Envíos</h1>
            <p className="text-xs text-muted-foreground">
              {data?.carriers ? `${data.carriers.map((c) => c.name).join(" · ")}` : "Operador"}
              {" · "}{open.length} en curso
            </p>
          </div>
          <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">Salir</Link>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>
        )}

        {data && data.shipments.length === 0 && (
          <div className="rounded-xl border border-border bg-background p-6 text-center">
            <p className="text-sm text-muted-foreground">Todavía no tenés encargos pendientes 🎉</p>
          </div>
        )}

        {/* Encargos en curso */}
        {open.map((s) => (
          <div key={s.id} className="rounded-xl border border-border bg-background p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold tracking-wide">{s.code}</p>
                <p className="text-xs text-muted-foreground truncate">{s.zoneName || "Zona extendida"} · {s.customerName || "—"}</p>
              </div>
              <span className="text-xs font-semibold px-2 py-1 rounded-full bg-violet-100 text-violet-900 whitespace-nowrap">
                {STATUS_ICON[s.status]} {s.statusLabel}
              </span>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>🏪 Retiro: {s.storeName} · {s.storeAddress}</p>
              <p>📍 Entrego: {s.customerName} · {s.customerPhone} · {s.customerAddress}</p>
              <p>🧾 {s.items.length} ítems · ${s.total.toLocaleString("es-AR")}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(NEXT_STEPS[s.status] || []).map((step) => (
                <Button
                  key={step.to}
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={busyId !== null}
                  onClick={() => {
                    setShowNoteFor(`${s.id}:${step.to}`);
                    setNoteText("");
                  }}
                >
                  {step.label}
                </Button>
              ))}
              {(s.status === "in_transit" || s.status === "picked_up" || s.status === "failed_attempt") && (
                <label className="text-xs border border-input rounded-md px-2 py-1 h-7 cursor-pointer hover:bg-muted/50">
                  📷 Foto
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadPod(s.id, f);
                    }}
                  />
                </label>
              )}
            </div>
            {showNoteFor?.startsWith(`${s.id}:`) && (
              <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-2">
                <p className="text-xs font-medium">{NEXT_STEPS[s.status].find((n) => `${s.id}:${n.to}` === showNoteFor)?.label} — nota (opcional):</p>
                <textarea
                  className="w-full text-xs rounded-md border border-input bg-background px-2 py-1.5 min-h-16"
                  placeholder="Ej: no estaba el destinatario / firmó el portero / reprogramó para mañana"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  maxLength={300}
                />
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowNoteFor(null)}>Cancelar</Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busyId !== null}
                    onClick={() => {
                      const to = showNoteFor.split(":")[1];
                      moveShipment(s, to, noteText.trim());
                    }}
                  >
                    Confirmar
                  </Button>
                </div>
              </div>
            )}
            {rowMsg[s.id] && <p className="text-[11px] text-amber-700">{rowMsg[s.id]}</p>}
          </div>
        ))}

        {/* Cerrados */}
        {closed.length > 0 && (
          <div className="rounded-xl border border-border bg-background p-3">
            <p className="text-xs font-semibold mb-2 text-muted-foreground">Recientes</p>
            <div className="space-y-1.5">
              {closed.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono tracking-wide">{s.code}</span>
                  <span className="truncate text-muted-foreground">{s.zoneName}</span>
                  <span className="whitespace-nowrap">{STATUS_ICON[s.status]} {s.statusLabel}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          Los pedidos asociados se sincronizan en el panel del comercio automáticamente.
        </p>
      </div>
    </main>
  );
}
