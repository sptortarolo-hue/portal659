"use client";

import { useCallback, useEffect, useState } from "react";

type Agent = {
  key: string;
  vendor_id: string | null;
  name: string;
  mode: string;
  enabled: boolean;
  tone: string;
  connected: boolean;
  messagesDay: number;
  handoffsDay: number;
};

/** Bot Studio (Fase 1): modo y switch por agente, sin código y sin deploy. */
export function BotAgentsPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/bots/agents");
      const data = await r.json();
      if (Array.isArray(data?.agents)) setAgents(data.agents);
    } catch { /* poll */ } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function patch(a: Agent, changes: Partial<Agent>) {
    setSaving(a.key);
    setMsg("");
    // optimista
    setAgents((prev) => prev.map((x) => (x.key === a.key ? { ...x, ...changes } : x)));
    try {
      const r = await fetch(`/api/admin/bots/agents/${encodeURIComponent(a.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || "No se pudo guardar");
      setMsg(`${a.name}: guardado ✓`);
      await load();
    } catch (e: any) {
      setMsg(`Error: ${e?.message || "no se pudo guardar"}`);
      await load();
    } finally { setSaving(null); }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">🤖 Bot Studio — agentes de WhatsApp</p>
          <p className="text-[11px] text-muted-foreground">
            Conserje u órdenes por comercio, sin código. El bot central también se edita acá.
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
          disabled={loading}
        >
          {loading ? "…" : "Actualizar"}
        </button>
      </div>

      {msg && <p className="text-[11px] text-muted-foreground">{msg}</p>}

      {!loading && agents.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Sin agentes. Aplicá la migración <code>migrate-bot-studio.sql</code> o creá uno desde un comercio.
        </p>
      ) : (
        <div className="space-y-1">
          {agents.map((a) => (
            <div key={a.key} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-2 py-1.5 text-xs">
              <span className="min-w-[140px] flex-1 truncate font-medium">
                {a.key === "portal" ? "🏪 " : ""}{a.name}
                {a.key === "portal" && <span className="ml-1 text-[10px] text-muted-foreground">(central)</span>}
              </span>
              <span className={`text-[10px] ${a.connected ? "text-emerald-600" : "text-muted-foreground"}`}>
                {a.connected ? "🟢 en línea" : "⚪ sin señal"}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {a.messagesDay} msgs · {a.handoffsDay} deriv.
              </span>
              <label className="flex items-center gap-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={a.enabled}
                  disabled={saving === a.key}
                  onChange={(e) => patch(a, { enabled: e.target.checked })}
                />
                Activo
              </label>
              <select
                value={a.mode}
                disabled={saving === a.key}
                onChange={(e) => patch(a, { mode: e.target.value })}
                className="rounded-md border border-border bg-background px-1.5 py-1 text-[11px]"
              >
                <option value="concierge">Conserje</option>
                <option value="orders">Órdenes</option>
              </select>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/70">
        Los cambios se guardan en DB y el cerebro los lee con cache de 5 min. Sin deploy. Si la tabla no existe, el bot sigue con el modo histórico.
      </p>
    </div>
  );
}
