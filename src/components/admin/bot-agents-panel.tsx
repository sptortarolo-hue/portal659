"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Chip, SectionHeader, StatusDot } from "@/components/panel-ui";
import { Button } from "@/components/ui/button";

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
  lastSeen: string | null;
};

/** Bot Studio: agentes como cards accionables (Fase 2a). */
export function BotAgentsPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/bots/agents");
      const data = await r.json();
      if (Array.isArray(data?.agents)) setAgents(data.agents);
    } catch { /* poll */ } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  async function toggle(a: Agent) {
    setSaving(a.key);
    setMsg("");
    setAgents((prev) => prev.map((x) => x.key === a.key ? { ...x, enabled: !x.enabled } : x));
    try {
      const r = await fetch(`/api/admin/bots/agents/${encodeURIComponent(a.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !a.enabled }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "No se pudo guardar");
      setMsg(`${a.name}: ${!a.enabled ? "activado" : "apagado"} ✓`);
      await load();
    } catch (e: any) {
      setMsg(`Error: ${e?.message || "no se pudo guardar"}`);
      await load();
    } finally { setSaving(null); }
  }

  const shown = agents.filter((a) => filter === "all" || (filter === "on" ? a.enabled : !a.enabled));
  const active = agents.filter((a) => a.enabled).length;
  const online = agents.filter((a) => a.connected).length;

  return (
    <div className="space-y-3">
      <SectionHeader
        title="🤖 Bot Studio"
        hint="Un agente por comercio + el central. Armalo acá, sin código y sin deploy."
        action={
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {(["all", "on", "off"] as const).map((f) => (
                <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                  {f === "all" ? `Todos (${agents.length})` : f === "on" ? `Activos (${active})` : `Apagados (${agents.length - active})`}
                </Chip>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>{loading ? "…" : "Actualizar"}</Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Card padding="sm" className="flex items-center justify-between">
          <span className="ts-caption uppercase tracking-wide text-muted-foreground">Agentes</span>
          <span className="ts-title">{agents.length}</span>
        </Card>
        <Card padding="sm" className="flex items-center justify-between">
          <span className="ts-caption uppercase tracking-wide text-muted-foreground">En línea</span>
          <span className="ts-title text-emerald-600">{online}</span>
        </Card>
        <Card padding="sm" className="flex items-center justify-between">
          <span className="ts-caption uppercase tracking-wide text-muted-foreground">Activos</span>
          <span className="ts-title">{active}</span>
        </Card>
      </div>

      {msg && <p className="ts-body text-muted-foreground">{msg}</p>}

      {!loading && shown.length === 0 ? (
        <Card padding="md">
          <p className="ts-body text-muted-foreground">
            No hay agentes para este filtro. Aplicá <code>migrate-bot-studio.sql</code> o creá uno desde un comercio.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {shown.map((a) => {
            const tone = a.connected ? "success" : a.enabled ? "warning" : "neutral";
            return (
              <Card key={a.key} variant="interactive" padding="md">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                        {a.key === "portal" ? "🏪" : a.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="ts-subtitle truncate">{a.name}</p>
                        <p className="ts-caption text-muted-foreground">
                          {a.key === "portal" ? "Bot central del portal" : a.vendor_id ? "Comercio" : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 ts-caption text-muted-foreground">
                    <StatusDot tone={tone as any} />
                    {a.connected ? "en línea" : a.enabled ? "sin señal" : "apagado"}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Chip active={a.mode === "orders"}>{a.mode === "orders" ? "Órdenes" : "Conserje"}</Chip>
                  <Chip>{a.tone === "humano" ? "Tono humano" : "Clásico"}</Chip>
                </div>

                <div className="mt-3 flex items-center gap-3 ts-caption text-muted-foreground">
                  <span>💬 {a.messagesDay} hoy</span>
                  <span>🙋 {a.handoffsDay} deriv.</span>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
                  <label className="flex items-center gap-2 ts-caption">
                    <input
                      type="checkbox"
                      checked={a.enabled}
                      disabled={saving === a.key}
                      onChange={() => toggle(a)}
                    />
                    Activo
                  </label>
                  <Link href={`/admin/bots/agents/${encodeURIComponent(a.key)}`}>
                    <Button variant="outline" size="sm">Abrir →</Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="ts-caption text-muted-foreground/70">
        Los cambios se guardan en DB y el cerebro los lee con cache de 5 min. Si la tabla no existe, el bot sigue con el modo histórico.
      </p>
    </div>
  );
}
