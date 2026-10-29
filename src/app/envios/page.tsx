"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { OperatorShipmentsMap, type OperatorMapPin } from "@/components/envios/operator-shipments-map";
import { DeliverCertSheet } from "@/components/envios/deliver-cert-sheet";
import { PickupCobroSheet, type PickupCobroResult } from "@/components/envios/pickup-cobro-sheet";
import {
  ShipmentsPipeline,
  fmtMoney,
  type PipelineShipment,
} from "@/components/envios/shipments-pipeline";

type ShipmentRow = PipelineShipment & {
  vendorLat: number | null;
  vendorLng: number | null;
  deliveredToName: string | null;
  deliveredDni: string | null;
  deliveredLat: number | null;
  deliveredLng: number | null;
  deliveredGeoOk: boolean;
  ackAt?: string | null;
};

type CarrierRow = { id: string; name: string };

type LoadData = {
  shipments: ShipmentRow[];
  carriers: CarrierRow[];
  ready: boolean;
  pending?: { carrierName: string; requestedAt: string } | null;
};

const OPEN_STATUSES = new Set(["requested", "picked_up", "in_transit", "failed_attempt"]);

export default function EnviosOperadorPage() {
  const [data, setData] = useState<LoadData | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [certS, setCertS] = useState<ShipmentRow | null>(null);
  const [cobroS, setCobroS] = useState<ShipmentRow | null>(null);
  const [view, setView] = useState<"etapas" | "mapa">("etapas");
  const [focused, setFocused] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<Date | null>(null);

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
      setData({
        shipments,
        carriers: Array.isArray(j?.carriers) ? j.carriers : [],
        ready: j.ready !== false,
        pending: j?.pending ?? null,
      });
      setError("");
      setLastAt(new Date());
      const unacked = shipments.filter((s) => !s.ackAt).map((s) => s.id);
      if (unacked.length > 0) {
        fetch("/api/shipments/operator/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shipmentIds: unacked }),
        }).catch(() => {});
      }
    } catch {
      setError("Error de red");
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30_000);
    const onFocus = () => fetchData();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchData]);

  async function postAdvance(
    s: ShipmentRow,
    to: string,
    note?: string,
    cert?: { name: string; dni: string; lat: number; lng: number; podPhotoUrl: string | null },
    payment?: PickupCobroResult | null
  ) {
    setBusyId(`${s.id}`);
    setRowMsg((m) => ({ ...m, [s.id]: "" }));
    try {
      const res = await fetch("/api/shipments/operator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentId: s.id,
          status: to,
          note: note || undefined,
          ...(cert
            ? {
                deliveredToName: cert.name,
                deliveredDni: cert.dni,
                deliveredLat: cert.lat,
                deliveredLng: cert.lng,
                podPhotoUrl: cert.podPhotoUrl || undefined,
              }
            : {}),
          ...(payment
            ? {
                payment: {
                  amount: payment.amount,
                  method: payment.method,
                  payerName: payment.payerName,
                  note: payment.note,
                },
              }
            : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRowMsg((m) => ({ ...m, [s.id]: j.error || "No se pudo actualizar" }));
        return false;
      }
      setNoteFor(null);
      setNoteText("");
      setCertS(null);
      setCobroS(null);
      await fetchData();
      return true;
    } catch {
      setRowMsg((m) => ({ ...m, [s.id]: "Error de red" }));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function onAdvance(s: ShipmentRow, to: string, note?: string) {
    if (to === "delivered") {
      setCertS(s);
      return;
    }
    if (to === "picked_up" && (s.carrierFee == null || s.carrierFee > 0)) {
      setCobroS(s);
      return;
    }
    void postAdvance(s, to, note);
  }

  async function uploadOperatorPod(file: File): Promise<string | null> {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/shipment-upload", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      return res.ok ? (j.url as string) : null;
    } catch {
      return null;
    }
  }

  if (data && data.carriers.length === 0 && data.ready) {
    const pending = data.pending;
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-4 bg-background text-center">
        {pending ? (
          <>
            <span className="text-4xl">⏳</span>
            <h1 className="font-display text-xl font-bold">Solicitud en revisión</h1>
            <p className="text-sm text-muted-foreground max-w-sm">
              Recibimos el registro de <b>{pending.carrierName}</b>. El equipo de Portal 659 lo está
              revisando y te avisa por WhatsApp cuando esté activo. Después cargás tus tarifas por
              zona y empezás a recibir encargos.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" variant="outline" onClick={fetchData}>
                🔄 Ver si ya me activaron
              </Button>
              <Link href="/logisticas">
                <Button size="sm" variant="outline">🚚 Cómo funciona</Button>
              </Link>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground max-w-sm">
              {error || "Tu cuenta no está vinculada a una logística partner. Si tenés una logística, pedile al equipo de Portal 659 el alta como operador — o registrala vos mismo."}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/registro-logistica">
                <Button size="sm">🚚 Registrar mi logística</Button>
              </Link>
              <Link href="/logisticas">
                <Button size="sm" variant="outline">Cómo funciona</Button>
              </Link>
              <Link href="/">
                <Button size="sm" variant="outline">← Ir a Portal 659</Button>
              </Link>
            </div>
          </>
        )}
      </main>
    );
  }

  const all = data?.shipments || [];
  const open = all.filter((s) => OPEN_STATUSES.has(s.status));
  const pins: OperatorMapPin[] = open
    .filter((s) => s.destLat != null && s.destLng != null)
    .map((s) => ({
      id: s.id,
      code: s.code,
      customerName: s.customerName,
      status: s.status,
      dest: { lat: s.destLat as number, lng: s.destLng as number },
    }));

  const today = all.filter((s) => {
    const d = new Date(s.requestedAt);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  });
  const collectedToday = today.filter((s) => s.status !== "requested" && s.status !== "cancelled");
  const deliveredToday = today.filter((s) => s.status === "delivered");
  const paymentsToday = collectedToday.map((s) => s.payment).filter((p): p is NonNullable<typeof p> => !!p);
  const cashToday = paymentsToday.filter((p) => p.status === "paid" && (p.method === "efectivo" || p.method === "mixto")).reduce((n, p) => n + p.amount, 0);
  const otherToday = paymentsToday.filter((p) => p.status === "paid" && p.method !== "efectivo" && p.method !== "mixto").reduce((n, p) => n + p.amount, 0);
  const debtToday = paymentsToday.filter((p) => p.status === "pending").reduce((n, p) => n + p.amount, 0);
  const toCollect = open.filter((s) => s.status === "requested" && !s.payment).reduce((n, s) => n + (s.carrierFee ?? 0), 0);

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="max-w-6xl mx-auto px-3 py-4 lg:px-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight">🚚 Portal 659 Envíos</h1>
            <p className="text-xs text-muted-foreground truncate">
              {data?.carriers?.length ? data.carriers.map((c) => c.name).join(" · ") : "Operador"}
              {" · "}{open.length} en curso
              {lastAt ? ` · act. ${lastAt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href="/envios/zonas" className="text-xs text-muted-foreground hover:text-foreground">
              🗺️ Mis zonas
            </Link>
            <span className="text-border">·</span>
            <Link href="/envios/tarifas" className="text-xs text-muted-foreground hover:text-foreground">
              💲 Mis tarifas
            </Link>
            <span className="text-border">·</span>
            <Link href="/envios/plan" className="text-xs text-muted-foreground hover:text-foreground">
              💳 Mi plan
            </Link>
            <span className="text-border">·</span>
            <Link href="/logisticas" className="text-xs text-muted-foreground hover:text-foreground">
              Cómo funciona
            </Link>
            <span className="text-border">·</span>
            <Link href="/" className="text-xs text-muted-foreground hover:text-foreground">
              Salir
            </Link>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <SummaryCard label="Colectados hoy" value={String(collectedToday.length)} hint={`${today.length} encargos del día`} />
          <SummaryCard label="Entregados hoy" value={String(deliveredToday.length)} hint={`${open.length} abiertos`} tone="violet" />
          <SummaryCard
            label="Cobrado hoy"
            value={fmtMoney(cashToday + otherToday)}
            hint={`💵 ${fmtMoney(cashToday)} · otros ${fmtMoney(otherToday)}`}
            tone="emerald"
          />
          <SummaryCard
            label="Deuda / por cobrar"
            value={fmtMoney(debtToday + toCollect)}
            hint={debtToday > 0 ? `📓 ${fmtMoney(debtToday)} en deuda` : `por colectar ${fmtMoney(toCollect)}`}
            tone={debtToday > 0 ? "amber" : "normal"}
          />
        </div>

        <div className="flex gap-2">
          <Button size="sm" variant={view === "etapas" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setView("etapas")}>
            📋 Etapas
          </Button>
          <Button size="sm" variant={view === "mapa" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setView("mapa")}>
            🗺️ Mapa ({pins.length})
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={fetchData}>
            🔄
          </Button>
        </div>

        {view === "mapa" && (
          <OperatorShipmentsMap pins={pins} focusId={focused} onSelectPin={(id) => setFocused(id)} />
        )}

        {view === "etapas" && (
          <>
            {data && all.length === 0 ? (
              <div className="rounded-xl border border-border bg-background p-6 text-center">
                <p className="text-sm text-muted-foreground">Todavía no tenés encargos 🎉</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Cuando un comercio avise que tiene un paquete para tu zona, te llega el aviso por WhatsApp y aparece acá.
                </p>
              </div>
            ) : (
              <ShipmentsPipeline
                shipments={all}
                busyId={busyId}
                rowMsg={rowMsg}
                noteFor={noteFor}
                noteText={noteText}
                onNoteFor={setNoteFor}
                onNoteText={setNoteText}
                onAdvance={(s, to, note) => onAdvance(s as ShipmentRow, to, note)}
              />
            )}
          </>
        )}

        {certS && (
          <DeliverCertSheet
            busy={busyId !== null}
            uploadEndpoint={uploadOperatorPod}
            onCancel={() => setCertS(null)}
            onSubmit={(payload) => {
              const s = certS;
              if (s) {
                void postAdvance(s, "delivered", payload.note, {
                  name: payload.deliveredToName,
                  dni: payload.deliveredDni,
                  lat: payload.deliveredLat,
                  lng: payload.deliveredLng,
                  podPhotoUrl: payload.podPhotoUrl,
                });
              }
            }}
          />
        )}

        {cobroS && (
          <PickupCobroSheet
            open
            busy={busyId !== null}
            storeName={cobroS.storeName}
            suggestedAmount={cobroS.carrierFee}
            onClose={() => setCobroS(null)}
            onConfirm={async (r) => {
              await postAdvance(cobroS, "picked_up", undefined, undefined, r);
            }}
          />
        )}

        <details className="rounded-xl border border-border bg-background px-3 py-2">
          <summary className="text-xs font-semibold cursor-pointer">¿Cómo uso el panel?</summary>
          <ul className="text-[11px] text-muted-foreground mt-2 space-y-1 list-disc pl-4">
            <li><b>🏪 Por colectar</b>: los paquetes que los locales ya te avisaron. El chip verde dice <b>cuánto te tienen que pagar al retirar</b>.</li>
            <li><b>📦 Colectar y cobrar</b>: registrás el pago del local (efectivo con vuelto, transferencia, tarjeta o deuda) y el paquete pasa a tu camioneta.</li>
            <li><b>🚚 Salir a repartir</b> marca En camino; recién ahí aparece <b>✅ Entregar</b> (exige quién recibió + DNI + GPS).</li>
            <li>Las tarjetas que llevan más de 12 h se ponen ámbar y más de 24 h rojas: una entrega fallida cuesta carísima, priorizalas.</li>
            <li>Si nadie recibe: <b>⚠️ No entregado</b> con motivo (ausente, dirección incorrecta, cerrado…) y después reintentás o devolvés al local.</li>
          </ul>
        </details>

        <p className="text-center text-[11px] text-muted-foreground">
          Los pedidos asociados se sincronizan en el panel del comercio automáticamente.
        </p>
      </div>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  tone = "normal",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "normal" | "violet" | "emerald" | "amber";
}) {
  const toneCls =
    tone === "violet"
      ? "border-violet-300 bg-violet-50"
      : tone === "emerald"
        ? "border-emerald-300 bg-emerald-50"
        : tone === "amber"
          ? "border-amber-300 bg-amber-50"
          : "border-border bg-background";
  return (
    <div className={`rounded-xl border px-3 py-2 ${toneCls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums leading-tight">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
