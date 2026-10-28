"use client";

import { useState } from "react";
import {
  mapsDirectionsUrl,
  mapsDirectionsUrlFromCoords,
  waUrlFromPhone,
  buyerVoyText,
} from "@/lib/shipping-geo";

/**
 * Tablero por etapas del panel de logística (Portal 659 Envíos).
 *
 * Desktop = columnas (kanban horizontal, patrón del Kanban de pedidos);
 * mobile = pestañas de etapa con contador + una sola lista. Inspirado en
 * los tableros de DispatchTrack/Fleetbase y en la app de Envíos Flex:
 * se ve el día entero de un vistazo y cada tarjeta tiene una acción
 * principal grande (uso con una mano, de pie, en la vereda).
 *
 * La tarjeta está centrada en el destinatario; los datos del local
 * (origen) solo aparecen plegados mientras el paquete sigue ahí.
 */

export type PipelineShipment = {
  id: string;
  code: string;
  status: string;
  statusLabel: string;
  zoneName: string | null;
  requestedAt: string;
  storeName: string | null;
  storeAddress: string | null;
  vendorLat: number | null;
  vendorLng: number | null;
  carrierName: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  destLat: number | null;
  destLng: number | null;
  orderNumber: number | null;
  total: number;
  etaDays: number | null;
  carrierFee: number | null;
  payment: {
    amount: number;
    method: string;
    status: "paid" | "pending";
    payerName: string | null;
  } | null;
  failedReason?: string | null;
};

export const STAGES = [
  { key: "requested", label: "Por colectar", icon: "🏪", tone: "bg-amber-100 text-amber-900 border-amber-300" },
  { key: "picked_up", label: "En la camioneta", icon: "📦", tone: "bg-sky-100 text-sky-900 border-sky-300" },
  { key: "in_transit", label: "En camino", icon: "🚚", tone: "bg-violet-100 text-violet-900 border-violet-300" },
  { key: "failed_attempt", label: "Reintentar", icon: "⚠️", tone: "bg-orange-100 text-orange-900 border-orange-300" },
] as const;

export const RECENT_STATUSES = ["delivered", "returned", "cancelled"];

type NextStep = { to: string; label: string; primary?: boolean; needsNote?: boolean };

/** Espejo server de las transiciones (Entregar exige En camino). */
export const NEXT_STEPS: Record<string, NextStep[]> = {
  requested: [
    { to: "picked_up", label: "📦 Colectar y cobrar", primary: true },
    { to: "returned", label: "↩️ Devolver" },
    { to: "cancelled", label: "❌ Cancelar" },
  ],
  picked_up: [
    { to: "in_transit", label: "🚚 Salir a repartir", primary: true },
    { to: "failed_attempt", label: "⚠️ No entregado", needsNote: true },
    { to: "returned", label: "↩️ Devolver", needsNote: true },
  ],
  in_transit: [
    { to: "delivered", label: "✅ Entregar", primary: true },
    { to: "failed_attempt", label: "⚠️ No entregado", needsNote: true },
  ],
  failed_attempt: [
    { to: "in_transit", label: "🚚 Reintentar", primary: true },
    { to: "returned", label: "↩️ Devolver", needsNote: true },
    { to: "cancelled", label: "❌ Cancelar", needsNote: true },
  ],
};

/** Motivos preset para "No entregado" (no texto libre: son datos, no relatos). */
export const FAIL_REASONS = [
  "Ausente",
  "Dirección incorrecta",
  "Local cerrado",
  "No contesta",
  "Rechazó el paquete",
  "Otro",
];

export function ageLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export function ageTone(iso: string | null | undefined): "normal" | "amber" | "red" {
  if (!iso) return "normal";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "normal";
  const h = (Date.now() - d.getTime()) / 3600000;
  if (h > 24) return "red";
  if (h > 12) return "amber";
  return "normal";
}

export function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}

const PAYMENT_LABEL: Record<string, string> = {
  efectivo: "💵 Efectivo",
  transferencia: "🏦 Transferencia",
  tarjeta: "💳 Tarjeta",
  mixto: "🪙 Mixto",
  fiado: "📓 Deuda",
};

export function ShipmentsPipeline({
  shipments,
  busyId,
  rowMsg,
  noteFor,
  noteText,
  onNoteFor,
  onNoteText,
  onAdvance,
  onFocusPin,
}: {
  shipments: PipelineShipment[];
  busyId: string | null;
  rowMsg: Record<string, string>;
  noteFor: string | null;
  noteText: string;
  onNoteFor: (key: string | null) => void;
  onNoteText: (t: string) => void;
  onAdvance: (s: PipelineShipment, to: string, note?: string) => void;
  onFocusPin?: (id: string | null) => void;
}) {
  const [mobileStage, setMobileStage] = useState<string>("requested");
  const [openStore, setOpenStore] = useState<string | null>(null);

  const byStage = (key: string) => shipments.filter((s) => s.status === key);
  const recent = shipments.filter((s) => RECENT_STATUSES.includes(s.status));
  const totalOpen = STAGES.reduce((n, st) => n + byStage(st.key).length, 0);

  return (
    <div className="space-y-3">
      {/* ===== Mobile: pestañas de etapa con contador ===== */}
      <div className="lg:hidden -mx-1 overflow-x-auto pb-1">
        <div className="flex gap-1.5 px-1">
          {STAGES.map((st) => {
            const n = byStage(st.key).length;
            const active = mobileStage === st.key;
            return (
              <button
                key={st.key}
                type="button"
                onClick={() => setMobileStage(st.key)}
                className={`flex-shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
                }`}
              >
                {st.icon} {st.label} <span className="tabular-nums opacity-80">{n}</span>
              </button>
            );
          })}
          <span className="flex-shrink-0 self-center text-[11px] text-muted-foreground pl-1">
            {totalOpen} abiertos
          </span>
        </div>
      </div>

      {/* ===== Desktop: columnas ===== */}
      <div className="hidden lg:flex gap-3 overflow-x-auto pb-2">
        {STAGES.map((st) => {
          const list = byStage(st.key);
          return (
            <div key={st.key} className="flex-1 min-w-[260px] rounded-xl border border-border bg-muted/40 flex flex-col">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${st.tone}`}>
                  {st.icon} {st.label}
                </span>
                <span className="text-lg font-bold tabular-nums text-muted-foreground">{list.length}</span>
              </div>
              <div className="flex-1 p-2 space-y-2 min-h-[200px]">
                {list.length === 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-6">Sin encargos acá 🎉</p>
                )}
                {list.map((s) => (
                  <ShipmentCard
                    key={s.id}
                    s={s}
                    compact
                    busy={busyId === s.id}
                    rowMsg={rowMsg[s.id]}
                    noteFor={noteFor}
                    noteText={noteText}
                    onNoteFor={onNoteFor}
                    onNoteText={onNoteText}
                    onAdvance={onAdvance}
                    openStore={openStore === s.id}
                    onToggleStore={() => setOpenStore(openStore === s.id ? null : s.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ===== Mobile: lista de la etapa elegida ===== */}
      <div className="lg:hidden space-y-2">
        {byStage(mobileStage).length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">Sin encargos en esta etapa 🎉</p>
        )}
        {byStage(mobileStage).map((s) => (
          <ShipmentCard
            key={s.id}
            s={s}
            busy={busyId === s.id}
            rowMsg={rowMsg[s.id]}
            noteFor={noteFor}
            noteText={noteText}
            onNoteFor={onNoteFor}
            onNoteText={onNoteText}
            onAdvance={onAdvance}
            openStore={openStore === s.id}
            onToggleStore={() => setOpenStore(openStore === s.id ? null : s.id)}
          />
        ))}
      </div>

      {/* ===== Recientes (colapsado) ===== */}
      {recent.length > 0 && (
        <details className="rounded-xl border border-border bg-card">
          <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-muted-foreground">
            ✅ Recientes ({recent.length})
          </summary>
          <div className="px-3 pb-3 space-y-1.5">
            {recent.slice(0, 20).map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-mono text-muted-foreground">{s.code}</span>
                <span className="truncate flex-1">{s.customerName || "—"}</span>
                <span className="text-muted-foreground">{s.statusLabel}</span>
                {s.payment && (
                  <span className={s.payment.status === "pending" ? "font-semibold text-amber-700" : "text-emerald-700"}>
                    {fmtMoney(s.payment.amount)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function ShipmentCard({
  s,
  compact = false,
  busy,
  rowMsg,
  noteFor,
  noteText,
  onNoteFor,
  onNoteText,
  onAdvance,
  openStore,
  onToggleStore,
}: {
  s: PipelineShipment;
  compact?: boolean;
  busy: boolean;
  rowMsg?: string;
  noteFor: string | null;
  noteText: string;
  onNoteFor: (key: string | null) => void;
  onNoteText: (t: string) => void;
  onAdvance: (s: PipelineShipment, to: string, note?: string) => void;
  openStore: boolean;
  onToggleStore: () => void;
}) {
  const steps = NEXT_STEPS[s.status] || [];
  const primary = steps.find((x) => x.primary) || steps[0];
  const tone = ageTone(s.requestedAt);
  const feePending = s.status === "requested" && !s.payment;
  const border =
    tone === "red"
      ? "border-red-300"
      : tone === "amber"
        ? "border-amber-300"
        : "border-border";
  const noteKey = `${s.id}:${primary?.to ?? ""}`;

  return (
    <div className={`rounded-xl border bg-card p-2.5 space-y-1.5 ${border}`}>
      {/* Fila 1: estado + código + aging */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-muted-foreground">{s.code}</span>
        <span className={`text-[10px] font-semibold ${tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-700" : "text-muted-foreground"}`}>
          {ageLabel(s.requestedAt)}
        </span>
      </div>

      {/* Fila 2: destinatario */}
      <p className={`font-bold leading-tight ${compact ? "text-sm" : "text-base"}`}>
        {s.customerName || "Destinatario"}
      </p>
      <p className="text-[11px] text-muted-foreground leading-snug">
        {s.customerAddress || "Sin dirección"}
        {s.customerPhone ? ` · ${s.customerPhone}` : ""}
      </p>

      {/* Fila 3: navegación */}
      <div className="flex flex-wrap gap-1.5">
        {s.destLat != null && s.destLng != null ? (
          <a href={mapsDirectionsUrlFromCoords(s.destLat, s.destLng)} target="_blank" rel="noopener noreferrer"
            className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-muted">
            🚗 Cómo llegar
          </a>
        ) : s.customerAddress ? (
          <a href={mapsDirectionsUrl(s.customerAddress)} target="_blank" rel="noopener noreferrer"
            className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-muted">
            🚗 Cómo llegar
          </a>
        ) : null}
        {s.customerPhone && waUrlFromPhone(s.customerPhone, buyerVoyText(s.code, s.storeName)) && (
          <a href={waUrlFromPhone(s.customerPhone, buyerVoyText(s.code, s.storeName)) ?? undefined} target="_blank" rel="noopener noreferrer"
            className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-muted">
            💬 WhatsApp
          </a>
        )}
      </div>

      {/* Fila 4: chips de zona / tarifa / cobro */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          🏠 {s.zoneName || "Zona extendida"}
        </span>
        {feePending && s.carrierFee != null && s.carrierFee > 0 && (
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
            💵 Cobrar {fmtMoney(s.carrierFee)} al local
          </span>
        )}
        {s.payment && (
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
              s.payment.status === "pending"
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-emerald-300 bg-emerald-50 text-emerald-800"
            }`}
          >
            {s.payment.status === "pending" ? "📓 Deuda" : "✅ Cobrado"} {fmtMoney(s.payment.amount)}
            {s.payment.method ? ` · ${PAYMENT_LABEL[s.payment.method] ?? s.payment.method}` : ""}
          </span>
        )}
      </div>

      {/* Origen plegado (solo mientras el paquete sigue en el local) */}
      {s.status === "requested" && (
        <div className="pt-0.5">
          <button type="button" onClick={onToggleStore} className="text-[10px] font-semibold text-muted-foreground hover:text-foreground">
            🏪 Colectar en {openStore ? "▲" : "▼"}
          </button>
          {openStore && (
            <div className="mt-1 rounded-lg border border-border bg-muted/40 px-2 py-1.5 text-[11px] space-y-1">
              <p className="font-semibold">{s.storeName || "Comercio"}</p>
              <p className="text-muted-foreground">{s.storeAddress || "Sin dirección"}</p>
              <div className="flex gap-2 flex-wrap">
                {s.vendorLat != null && s.vendorLng != null && (
                  <a href={mapsDirectionsUrlFromCoords(s.vendorLat, s.vendorLng)} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary">
                    🚗 Cómo llegar al local
                  </a>
                )}
                {s.orderNumber != null && <span className="text-muted-foreground">Pedido #{s.orderNumber}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Acción principal */}
      {primary && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (primary.needsNote) {
              onNoteFor(noteFor === noteKey ? null : noteKey);
              return;
            }
            onAdvance(s, primary.to);
          }}
          className={`w-full h-10 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 ${
            primary.primary
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "border border-border bg-background hover:bg-muted"
          }`}
        >
          {busy ? "..." : primary.label}
        </button>
      )}

      {/* Acciones secundarias */}
      {steps.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {steps
            .filter((x) => x.to !== primary?.to)
            .map((x) => (
              <button
                key={x.to}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (x.needsNote) {
                    onNoteFor(noteFor === `${s.id}:${x.to}` ? null : `${s.id}:${x.to}`);
                    return;
                  }
                  onAdvance(s, x.to);
                }}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
              >
                {x.label}
              </button>
            ))}
        </div>
      )}

      {/* Nota (motivo de falla / devolución) */}
      {noteFor != null && noteFor.startsWith(`${s.id}:`) && (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-2">
          <p className="text-xs font-semibold text-muted-foreground">Motivo / nota</p>
          <div className="flex flex-wrap gap-1">
            {FAIL_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onNoteText(noteText === r ? "" : r)}
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  noteText === r ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            className="w-full rounded-lg border border-input bg-background px-2 py-1 text-xs"
            rows={2}
            maxLength={250}
            value={noteText}
            onChange={(e) => onNoteText(e.target.value)}
            placeholder="Detalle (opcional)"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const to = noteFor.split(":")[1];
                onAdvance(s, to, noteText.trim() || undefined);
                onNoteFor(null);
                onNoteText("");
              }}
              className="flex-1 h-8 rounded-lg bg-primary text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={() => {
                onNoteFor(null);
                onNoteText("");
              }}
              className="h-8 rounded-lg border border-border px-3 text-xs font-medium"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {s.failedReason && s.status !== "failed_attempt" && (
        <p className="text-[10px] text-muted-foreground">❌ {s.failedReason}</p>
      )}
      {rowMsg && <p className="text-[11px] font-semibold text-red-600">{rowMsg}</p>}
    </div>
  );
}
