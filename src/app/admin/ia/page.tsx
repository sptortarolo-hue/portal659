"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Chip, EmptyState, SectionHeader } from "@/components/panel-ui";
import { Button } from "@/components/ui/button";

type Row = {
  source: string; provider: string; model: string; agent_key: string;
  tokens: string; prompt: string; completion: string; calls: string; cost: number; failures: string;
};
type Daily = { day: string; tokens: string; cost: number; calls: string };
type MonthRow = { provider: string; tokens: string; cost: number; calls: string };
type UsageData = {
  days: number;
  rows: Row[];
  daily: Daily[];
  monthByProvider: MonthRow[];
  budgets: Record<string, number | null>;
  quotas: {
    openrouter: any;
    groq: any;
    gemini: any;
  };
};

const PROVIDERS = [
  { id: "gemini", label: "Gemini", emoji: "✨", note: "Cuota real: consultala en AI Studio" },
  { id: "groq", label: "Groq", emoji: "⚡", note: "Sin cuota mensual por API; mostramos headers de la última llamada" },
  { id: "openrouter", label: "OpenRouter", emoji: "🌐", note: "Cuota real leída de /api/v1/key" },
] as const;

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v: string | number | null | undefined) => Number(v || 0).toLocaleString("es-AR");

export default function AdminIaPage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async (d: number) => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/admin/llm/usage?days=${d}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "No se pudo cargar");
      setData(j);
      const b = j.budgets || {};
      setDrafts({
        gemini: b.gemini == null ? "" : String(b.gemini),
        groq: b.groq == null ? "" : String(b.groq),
        openrouter: b.openrouter == null ? "" : String(b.openrouter),
      });
    } catch (e: any) { setError(e?.message || "No se pudo cargar"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  async function saveBudget(provider: string) {
    setSaving(provider); setMsg("");
    try {
      const raw = drafts[provider]?.trim();
      const value = raw === "" ? null : Number(raw.replace(",", "."));
      const r = await fetch("/api/admin/llm/budget", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, value }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || "No se pudo guardar");
      setMsg(`${provider}: presupuesto guardado ✓`);
      await load(days);
    } catch (e: any) { setMsg(`Error: ${e?.message || "no se pudo guardar"}`); }
    finally { setSaving(null); }
  }

  const totals = data?.rows?.reduce((acc, r) => ({
    tokens: acc.tokens + Number(r.tokens || 0),
    cost: acc.cost + Number(r.cost || 0),
    calls: acc.calls + Number(r.calls || 0),
    failures: acc.failures + Number(r.failures || 0),
  }), { tokens: 0, cost: 0, calls: 0, failures: 0 }) || { tokens: 0, cost: 0, calls: 0, failures: 0 };
  const maxDaily = Math.max(1, ...(data?.daily || []).map((d) => Number(d.tokens || 0)));
  const monthCost = (p: string) => Number(data?.monthByProvider?.find((m) => m.provider === p)?.cost || 0);

  return (
    <div className="space-y-4 ts-ui">
      <div className="flex items-center gap-2 ts-caption text-muted-foreground">
        <Link href="/admin/bots" className="hover:text-foreground">← Bots</Link>
        <span>/</span><span className="text-foreground">Costos de IA</span>
      </div>

      <SectionHeader
        title="💰 Costos y cuota de IA"
        hint="Gasto real de todos los lugares donde el portal usa IA: bot de WhatsApp, extracción de facturas, playground y laboratorio."
        action={
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {[7, 30, 90].map((d) => <Chip key={d} active={days === d} onClick={() => setDays(d)}>{d} días</Chip>)}
            </div>
            <Button variant="outline" size="sm" onClick={() => load(days)} disabled={loading}>{loading ? "…" : "Actualizar"}</Button>
          </div>
        }
      />

      {error && (
        <Card padding="md">
          <p className="ts-body text-destructive">{error}</p>
          <p className="ts-caption text-muted-foreground mt-1">
            Si dice que falta la migración, corré en el VPS:{" "}
            <code>docker exec -i portal659-db psql -U portal659 -d portal659 &lt; supabase/self-host/migrate-llm-usage.sql</code>
          </p>
        </Card>
      )}
      {msg && <p className="ts-caption text-muted-foreground">{msg}</p>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Card padding="sm"><p className="ts-caption text-muted-foreground">Tokens ({days}d)</p><p className="ts-title">{num(totals.tokens)}</p></Card>
        <Card padding="sm"><p className="ts-caption text-muted-foreground">Costo ({days}d)</p><p className="ts-title">{money(totals.cost)}</p></Card>
        <Card padding="sm"><p className="ts-caption text-muted-foreground">Llamadas ({days}d)</p><p className="ts-title">{num(totals.calls)}</p></Card>
        <Card padding="sm"><p className="ts-caption text-muted-foreground">Fallidas</p><p className="ts-title">{num(totals.failures)}</p></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {PROVIDERS.map((p) => {
          const budget = data?.budgets?.[p.id] ?? null;
          const spent = monthCost(p.id);
          const q = data?.quotas?.[p.id];
          const orRemaining = p.id === "openrouter" && q?.available && q.remaining != null ? Number(q.remaining) : null;
          const remaining = orRemaining ?? (budget != null ? Math.max(0, budget - spent) : null);
          const pct = budget && budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0;
          return (
            <Card key={p.id} padding="md" className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="ts-subtitle">{p.emoji} {p.label}</p>
                <Chip active={orRemaining != null}>{orRemaining != null ? "Cuota en vivo" : budget != null ? "Presupuesto propio" : "Sin tope"}</Chip>
              </div>
              <div>
                <p className="ts-caption text-muted-foreground">Gasto este mes (medido)</p>
                <p className="ts-title">{money(spent)}</p>
              </div>
              <div>
                <p className="ts-caption text-muted-foreground">Queda</p>
                <p className={`ts-title ${remaining != null && remaining < 5 ? "text-destructive" : "text-emerald-600"}`}>
                  {remaining != null ? money(remaining) : "—"}
                </p>
                {budget != null && budget > 0 && (
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className={`h-full ${pct >= 80 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
              <div className="rounded-lg bg-muted/40 p-2 space-y-1">
                <p className="ts-caption text-muted-foreground">{p.note}</p>
                {p.id === "openrouter" && q?.available && (
                  <p className="ts-caption text-muted-foreground">
                    Límite {money(q.limit)} · usado este mes {money(q.usageMonthly)}
                    {q.resetsAt ? ` · resetea ${new Date(q.resetsAt).toLocaleDateString("es-AR")}` : ""}
                  </p>
                )}
                {p.id === "openrouter" && !q?.available && <p className="ts-caption text-muted-foreground">{q?.reason || "sin datos"}</p>}
                {p.id === "groq" && q?.remainingTokens != null && (
                  <p className="ts-caption text-muted-foreground">Tokens restantes (última llamada): {num(q.remainingTokens)}</p>
                )}
              </div>
              <div className="flex items-end gap-2">
                <label className="flex-1 ts-caption">Presupuesto mensual USD (vacío = sin tope)
                  <input type="number" min={0} step="1" className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                    value={drafts[p.id] ?? ""} onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })}
                    placeholder="Sin declarar" />
                </label>
                <Button size="sm" disabled={saving === p.id} onClick={() => saveBudget(p.id)}>{saving === p.id ? "…" : "Guardar"}</Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card padding="md">
        <p className="ts-subtitle mb-2">Consumo por origen / agente / modelo</p>
        {!data || data.rows.length === 0 ? (
          <EmptyState title="Sin consumo registrado" hint="Cuando el bot o la extracción de facturas hagan una llamada, aparece acá." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left ts-caption">
              <thead className="text-muted-foreground border-b border-border">
                <tr><th className="py-2">Origen</th><th>Agente</th><th>Proveedor / modelo</th><th className="text-right">Llamadas</th><th className="text-right">Tokens</th><th className="text-right">Costo</th></tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/60">
                    <td className="py-2">{r.source}</td>
                    <td className="truncate max-w-48">{r.agent_key}</td>
                    <td className="truncate max-w-64">{r.provider} · {r.model}</td>
                    <td className="text-right">{num(r.calls)}</td>
                    <td className="text-right">{num(r.tokens)}</td>
                    <td className="text-right">{money(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card padding="md">
        <p className="ts-subtitle mb-2">Tokens por día (huso Argentina)</p>
        {data?.daily?.length ? (
          <div className="flex h-32 items-end gap-1 overflow-x-auto">
            {data.daily.map((d) => (
              <div key={d.day} className="group flex min-w-3 flex-1 flex-col items-center justify-end" title={`${d.day}: ${num(d.tokens)} tokens · ${money(d.cost)}`}>
                <div className="w-full rounded-t bg-primary/80 group-hover:bg-primary" style={{ height: `${Math.max(3, (Number(d.tokens || 0) / maxDaily) * 100)}%` }} />
                <span className="mt-1 text-[9px] text-muted-foreground">{d.day.slice(5)}</span>
              </div>
            ))}
          </div>
        ) : <p className="ts-caption text-muted-foreground">Sin datos en el período.</p>}
      </Card>

      <p className="ts-caption text-muted-foreground/70">
        El costo de OpenRouter es el que reporta el proveedor. Los demás se estiman con la tabla de precios compartida
        (`services/wa-bot/src/llm-pricing.json`, actualizada {data ? "24/11/2026" : ""}) y se marcan como estimados.
        No se guardan prompts ni respuestas, sólo contadores. Las alertas al 80% y la retención de 90 días corren por cron.
      </p>
    </div>
  );
}
