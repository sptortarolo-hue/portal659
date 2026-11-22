"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useVoiceAnnouncement } from "@/hooks/use-voice-announcement";
import { VoiceToggle } from "./voice-toggle";

interface BankDeposit {
  id: number;
  bank: string;
  amount: number;
  sender_name: string | null;
  operation_id: string | null;
  received_at: string;
  matched_order_id: number | null;
  match_confidence: string;
  order_id?: number;
  order_total?: number;
  order_customer_name?: string;
  order_status?: string;
}

interface BankConciliationProps {
  vendorId: number;
  enabled: boolean;
  banks: string[];
  voiceEnabled: boolean;
  onSettingsChange: (settings: { enabled: boolean; banks: string[]; voice: boolean }) => void;
}

const BANK_NAMES: Record<string, string> = {
  galicia: "Banco Galicia",
  santander: "Santander",
  bbva: "BBVA",
  brubank: "Brubank",
  uala: "Ualá",
  naranjax: "Naranja X",
  mercadopago: "Mercado Pago",
  macro: "Banco Macro",
  cuentadni: "Cuenta DNI (BNA)",
  provincia: "Banco Provincia",
  generic: "Otro banco",
};

const CONFIDENCE_LABELS: Record<string, { label: string; color: string }> = {
  exact: { label: "✅ Matcheado automáticamente", color: "text-green-600" },
  probable: { label: "🔍 Posible match — confirmar", color: "text-amber-600" },
  unmatched: { label: "❓ Sin asignar", color: "text-red-600" },
  manual: { label: "✋ Asignado manualmente", color: "text-blue-600" },
  ignored: { label: "🚫 Ignorado", color: "text-gray-400" },
};

export function BankConciliation({ vendorId, enabled, banks, voiceEnabled, onSettingsChange }: BankConciliationProps) {
  const [deposits, setDeposits] = useState<BankDeposit[]>([]);
  const [unmatchedCount, setUnmatchedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const prevCount = useRef(0);
  const { speak } = useVoiceAnnouncement(voiceEnabled);

  const fetchDeposits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/vendor/bank-deposits?status=${filter}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setDeposits(data.deposits || []);
        setUnmatchedCount(data.unmatchedCount || 0);
      }
    } catch {}
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    if (enabled) fetchDeposits();
  }, [enabled, fetchDeposits]);

  // Polling cada 30s para nuevos depósitos
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(fetchDeposits, 30000);
    return () => clearInterval(interval);
  }, [enabled, fetchDeposits]);

  // Anunciar nuevos depósitos por voz
  useEffect(() => {
    if (voiceEnabled && deposits.length > prevCount.current) {
      const newest = deposits[0];
      if (newest) {
        const amount = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(newest.amount);
        speak(`Transferencia ingresada de ${newest.sender_name || "desconocido"} por ${amount}`);
      }
    }
    prevCount.current = deposits.length;
  }, [deposits, voiceEnabled, speak]);

  const handleConfirm = async (depositId: number, orderId?: number) => {
    try {
      await fetch(`/api/vendor/bank-deposits/${depositId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", orderId }),
      });
      fetchDeposits();
    } catch {}
  };

  const handleIgnore = async (depositId: number) => {
    try {
      await fetch(`/api/vendor/bank-deposits/${depositId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ignore" }),
      });
      fetchDeposits();
    } catch {}
  };

  const handleAssign = async (depositId: number, orderId: number) => {
    try {
      await fetch("/api/vendor/bank-deposits/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depositId, orderId }),
      });
      fetchDeposits();
    } catch {}
  };

  if (!enabled) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        <p>Conciliación bancaria desactivada.</p>
        <p className="text-xs mt-1">Activala en Configuración → Pagos y cobros.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header con filtros */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">
          Depósitos detectados
          {unmatchedCount > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700">
              {unmatchedCount} sin asignar
            </span>
          )}
        </h3>
        <div className="flex gap-1">
          {["all", "unmatched", "probable", "exact"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-xs px-2 py-1 rounded ${filter === f ? "bg-primary text-white" : "bg-muted"}`}
            >
              {f === "all" ? "Todos" : f === "unmatched" ? "Sin asignar" : f === "probable" ? "Probables" : "Matcheados"}
            </button>
          ))}
        </div>
      </div>

      {/* Lista de depósitos */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : deposits.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay depósitos detectados.</p>
      ) : (
        <div className="space-y-2">
          {deposits.map((dep) => {
            const conf = CONFIDENCE_LABELS[dep.match_confidence] || CONFIDENCE_LABELS.unmatched;
            return (
              <div key={dep.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-sm">
                      {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(dep.amount)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {BANK_NAMES[dep.bank] || dep.bank}
                    </span>
                  </div>
                  <span className={`text-xs ${conf.color}`}>{conf.label}</span>
                </div>

                <div className="text-xs text-muted-foreground">
                  {dep.sender_name && <span>De: {dep.sender_name} · </span>}
                  {new Date(dep.received_at).toLocaleString("es-AR")}
                  {dep.operation_id && <span> · Op: {dep.operation_id}</span>}
                </div>

                {/* Pedido asociado */}
                {dep.matched_order_id && (
                  <div className="text-xs bg-muted/50 rounded p-2">
                    Pedido #{dep.matched_order_id}
                    {dep.order_customer_name && ` — ${dep.order_customer_name}`}
                    {dep.order_status && ` (${dep.order_status})`}
                  </div>
                )}

                {/* Acciones */}
                <div className="flex gap-2 flex-wrap">
                  {dep.match_confidence === "probable" && dep.matched_order_id && (
                    <button
                      onClick={() => handleConfirm(dep.id)}
                      className="text-xs px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700"
                    >
                      ✅ Confirmar
                    </button>
                  )}
                  {dep.match_confidence === "unmatched" && (
                    <button
                      onClick={() => {
                        const orderId = prompt("ID del pedido:");
                        if (orderId) handleAssign(dep.id, parseInt(orderId));
                      }}
                      className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                    >
                      🔗 Asignar a pedido
                    </button>
                  )}
                  {dep.match_confidence !== "ignored" && (
                    <button
                      onClick={() => handleIgnore(dep.id)}
                      className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
                    >
                      🚫 Ignorar
                    </button>
                  )}
                  {dep.matched_order_id && dep.match_confidence !== "ignored" && (
                    <button
                      onClick={async () => {
                        await fetch(`/api/vendor/bank-deposits/${dep.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "unmatch" }),
                        });
                        fetchDeposits();
                      }}
                      className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200"
                    >
                      ↩️ Desasociar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={fetchDeposits}
        className="text-xs text-muted-foreground hover:underline"
      >
        🔄 Actualizar
      </button>
    </div>
  );
}