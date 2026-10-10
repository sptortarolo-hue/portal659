"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { OrderStatus } from "@/types/database";

type BotRow = {
  vendor_id: string;
  store_name: string;
  slug: string | null;
  status: string | null; // linked | pairing | unlinked | null
  enabled: boolean;
  wa_phone: string | null;
  updated_at: string | null;
  connected: boolean;
  conversations: number;
  sentHour: number;
  sentDay: number;
  newChatsHour: number;
};

type LlmInfo = {
  hasKey: boolean;
  ok: number;
  fail: number;
  cooldown: number;
  lastModel: string | null;
  lastAt: string | null;
} | null;

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusMeta(row: BotRow): { label: string; className: string } {
  if (row.status === "pairing") return { label: "🟡 Pareando (esperando QR)", className: "bg-amber-100 text-amber-800 border-amber-200" };
  if (row.status === "unlinked") return { label: "🔴 Desvinculado (LoggedOut)", className: "bg-red-100 text-red-700 border-red-200" };
  if (row.connected) return { label: "🟢 Conectado", className: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  if (row.status === "linked") return { label: "⚪ Vinculado, sin señal", className: "bg-muted text-muted-foreground border-border" };
  return { label: "⚪ Desconocido", className: "bg-muted text-muted-foreground border-border" };
}

export default function AdminBotsPage() {
  const [bots, setBots] = useState<BotRow[]>([]);
  const [llm, setLlm] = useState<LlmInfo>(null);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/bots");
      const data = await res.json();
      if (data?.bots) {
        setBots(data.bots);
        setLlm(data.llm ?? null);
      }
    } catch {
      // el poll sigue
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30_000);
    return () => clearInterval(t);
  }, [fetchData]);

  async function toggleBot(row: BotRow) {
    if (togglingId) return;
    setTogglingId(row.vendor_id);
    setMsg("");
    try {
      const res = await fetch(`/api/admin/bots/${row.vendor_id}/toggle`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setMsg(data?.error || "No se pudo cambiar el bot.");
        return;
      }
      setMsg(`${row.store_name}: bot ${data.enabled ? "ENCENDIDO" : "APAGADO"}.`);
      await fetchData();
    } catch {
      setMsg("Error de red.");
    } finally {
      setTogglingId(null);
    }
  }

  const conAlerta = bots.filter((b) => !b.enabled || b.status === "unlinked");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold">Bots de WhatsApp</h2>
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-foreground">← Dashboard</Link>
      </div>

      {msg && <div className="rounded-xl border border-border bg-muted px-3 py-2 text-sm">{msg}</div>}

      {/* LLM */}
      <div className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">IA del bot</p>
        {llm ? (
          <div className="text-xs text-right">
            <p className={llm.ok > 0 ? "text-emerald-600 font-medium" : llm.fail > 0 ? "text-amber-600 font-medium" : "text-muted-foreground"}>
              {llm.hasKey ? `ok ${llm.ok} · fallas ${llm.fail}` : "Sin LLM_API_KEY"}
            </p>
            <p className="text-muted-foreground">{llm.lastModel || "-"}{llm.lastAt ? ` · ${fmtDate(llm.lastAt)}` : ""}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">El cerebro no está conectado (revisá el servicio wabot)</p>
        )}
      </div>

      {conAlerta.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠️ {conAlerta.length} comercio{conAlerta.length !== 1 ? "s" : ""} con el bot apagado o desvinculado: {conAlerta.map((b) => b.store_name).join(", ")}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : bots.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">💬</div>
          <p className="text-muted-foreground text-sm">Ningún comercio tiene el bot de WhatsApp configurado todavía</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bots.map((b) => {
            const meta = statusMeta(b);
            return (
              <div key={b.vendor_id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{b.store_name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium border ${meta.className}`}>{meta.label}</span>
                      {!b.enabled && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-red-100 text-red-700">APAGADO</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {b.wa_phone || "-"} · última actividad: {fmtDate(b.updated_at)}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70">
                      📤 {b.sentHour}/h · {b.sentDay}/día · 💬 {b.conversations} conversación{b.conversations !== 1 ? "es" : ""} activa{b.conversations !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={b.enabled ? "outline" : "default"}
                    disabled={togglingId === b.vendor_id}
                    onClick={() => toggleBot(b)}
                  >
                    {togglingId === b.vendor_id ? "…" : b.enabled ? "Apagar bot" : "Encender bot"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
