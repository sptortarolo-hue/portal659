"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, Chip, EmptyState, SectionHeader, StatusDot } from "@/components/panel-ui";
import { Button } from "@/components/ui/button";

type FAQ = { id: string; question: string; answer: string; active: boolean };
type Agent = {
  key: string;
  name: string;
  mode: string;
  enabled: boolean;
  tone: string;
  greeting: string | null;
  handoff_phone: string | null;
  store_name: string | null;
  brief: Record<string, unknown>;
  model: string | null;
};

const TABS = [
  { id: "basics", label: "✏️ Básicos" },
  { id: "knowledge", label: "📚 Conocimiento" },
  { id: "channel", label: "📱 Canal" },
  { id: "playground", label: "💬 Playground" },
  { id: "metrics", label: "📊 Métricas" },
] as const;
type Tab = typeof TABS[number]["id"];

export function BotAgentEditor({ agentKey }: { agentKey: string }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [prompt, setPrompt] = useState("");
  const [tab, setTab] = useState<Tab>("basics");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [faqForm, setFaqForm] = useState({ question: "", answer: "" });

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}`);
    if (!r.ok) return;
    const d = await r.json();
    setAgent(d.agent);
    setPrompt(d.prompt || "");
    const f = await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}/faqs`);
    if (f.ok) setFaqs((await f.json()).faqs || []);
  }, [agentKey]);
  useEffect(() => { load(); }, [load]);

  async function save(patch: Partial<Agent>) {
    setSaving(true); setMsg("");
    try {
      const r = await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "No se pudo guardar");
      setMsg("Guardado ✓"); await load();
    } catch (e: any) { setMsg(`Error: ${e?.message || "no se pudo guardar"}`); }
    finally { setSaving(false); }
  }

  async function addFaq() {
    if (!faqForm.question.trim() || !faqForm.answer.trim()) return;
    const r = await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}/faqs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(faqForm),
    });
    if (r.ok) { setFaqForm({ question: "", answer: "" }); await load(); }
  }
  async function toggleFaq(f: FAQ) {
    await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}/faqs/${f.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !f.active }),
    });
    await load();
  }
  async function deleteFaq(f: FAQ) {
    await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}/faqs/${f.id}`, { method: "DELETE" });
    await load();
  }

  if (!agent) return <Card padding="md"><p className="ts-body text-muted-foreground">Cargando agente…</p></Card>;

  const brief = agent.brief || {};
  const setBrief = (key: string, value: unknown) => save({ brief: { ...brief, [key]: value } } as any);

  return (
    <div className="space-y-4 ts-ui">
      <div className="flex items-center gap-2 ts-caption text-muted-foreground">
        <Link href="/admin/bots" className="hover:text-foreground">← Bots</Link>
        <span>/</span><span className="text-foreground">{agent.name}</span>
      </div>

      <Card padding="md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-lg">
              {agent.key === "portal" ? "🏪" : agent.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <h1 className="ts-title truncate">{agent.name}</h1>
              <p className="ts-body text-muted-foreground">{agent.store_name || "Bot central del portal"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Chip active={agent.mode === "orders"}>{agent.mode === "orders" ? "Órdenes" : "Conserje"}</Chip>
            <label className="flex items-center gap-2 ts-caption">
              <input type="checkbox" checked={agent.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
              Activo
            </label>
          </div>
        </div>
        {msg && <p className="ts-caption mt-2 text-muted-foreground">{msg}</p>}
      </Card>

      <div className="flex flex-wrap gap-1 border-b border-border pb-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 ts-caption ${tab === t.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "basics" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card padding="md" className="space-y-3">
            <CardHeader><CardTitle>Identidad</CardTitle></CardHeader>
            <label className="block ts-caption">Nombre
              <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                defaultValue={agent.name} onBlur={(e) => e.target.value !== agent.name && save({ name: e.target.value })} />
            </label>
            <label className="block ts-caption">Saludo
              <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body" rows={3}
                defaultValue={agent.greeting || ""} onBlur={(e) => e.target.value !== (agent.greeting || "") && save({ greeting: e.target.value })} />
            </label>
            <label className="block ts-caption">Tono
              <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={agent.tone} onChange={(e) => save({ tone: e.target.value })}>
                <option value="humano">Humano (vos/tú)</option>
                <option value="clasico">Clásico</option>
              </select>
            </label>
            <label className="block ts-caption">Teléfono de derivación
              <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                defaultValue={agent.handoff_phone || ""} placeholder="5491100000000"
                onBlur={(e) => e.target.value !== (agent.handoff_phone || "") && save({ handoff_phone: e.target.value })} />
            </label>
          </Card>

          <Card padding="md" className="space-y-3">
            <CardHeader><CardTitle>Brief del negocio</CardTitle></CardHeader>
            <label className="block ts-caption">Qué hace el negocio
              <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body" rows={2}
                defaultValue={String(brief.instructions || "")} onBlur={(e) => e.target.value !== String(brief.instructions || "") && setBrief("instructions", e.target.value)} />
            </label>
            <label className="block ts-caption">Productos / servicios
              <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body" rows={2}
                defaultValue={String(brief.products || "")} onBlur={(e) => e.target.value !== String(brief.products || "") && setBrief("products", e.target.value)} />
            </label>
            <label className="block ts-caption">Público
              <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                defaultValue={String(brief.audience || "")} onBlur={(e) => e.target.value !== String(brief.audience || "") && setBrief("audience", e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block ts-caption">Siempre (una por línea)
                <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body" rows={3}
                  defaultValue={(brief.always as string[] || []).join("\n")}
                  onBlur={(e) => setBrief("always", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} />
              </label>
              <label className="block ts-caption">Nunca (una por línea)
                <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body" rows={3}
                  defaultValue={(brief.never as string[] || []).join("\n")}
                  onBlur={(e) => setBrief("never", e.target.value.split("\n").map((x) => x.trim()).filter(Boolean))} />
              </label>
            </div>
          </Card>

          <Card padding="md" className="lg:col-span-2">
            <CardHeader><CardTitle>Vista previa del prompt del agente</CardTitle></CardHeader>
            <p className="ts-caption text-muted-foreground mb-2">
              Bloque aditivo: se agrega al system prompt solo si cargaste algo. {prompt.length} caracteres.
            </p>
            <pre className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 ts-caption text-foreground max-h-64 overflow-auto">
              {prompt || "(Todavía no cargaste brief ni conocimiento — el bot usa el prompt estándar de Portal 659.)"}
            </pre>
          </Card>
        </div>
      )}

      {tab === "knowledge" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card padding="md" className="space-y-3">
            <CardHeader><CardTitle>Nueva pregunta / respuesta</CardTitle></CardHeader>
            <label className="block ts-caption">Pregunta
              <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={faqForm.question} onChange={(e) => setFaqForm({ ...faqForm, question: e.target.value })}
                placeholder="¿Hacen delivery?" />
            </label>
            <label className="block ts-caption">Respuesta
              <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body" rows={4}
                value={faqForm.answer} onChange={(e) => setFaqForm({ ...faqForm, answer: e.target.value })}
                placeholder="Sí, entregamos en toda la zona de Sicardi y Garibaldi." />
            </label>
            <Button size="sm" onClick={addFaq} disabled={!faqForm.question.trim() || !faqForm.answer.trim()}>Agregar</Button>
          </Card>
          <Card padding="md">
            <CardHeader><CardTitle>Preguntas cargadas ({faqs.length})</CardTitle></CardHeader>
            {faqs.length === 0 ? (
              <EmptyState title="Sin conocimiento todavía" hint="Cargá preguntas frecuentes para que el bot responda con tus palabras." />
            ) : (
              <div className="space-y-2 mt-2">
                {faqs.map((f) => (
                  <div key={f.id} className={`rounded-lg border border-border p-2 ${f.active ? "" : "opacity-60"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="ts-body font-medium">P: {f.question}</p>
                      <div className="flex gap-1 shrink-0">
                        <button className="ts-caption hover:underline" onClick={() => toggleFaq(f)}>{f.active ? "Desactivar" : "Activar"}</button>
                        <button className="ts-caption text-destructive hover:underline" onClick={() => deleteFaq(f)}>Borrar</button>
                      </div>
                    </div>
                    <p className="ts-caption text-muted-foreground mt-1">R: {f.answer}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "channel" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card padding="md" className="space-y-3">
            <CardHeader><CardTitle>Modo de atención</CardTitle></CardHeader>
            <p className="ts-body text-muted-foreground">
              Elegí qué hace el bot cuando le escriben. El cambio se aplica sin código ni deploy.
            </p>
            <div className="flex flex-wrap gap-2">
              <Chip active={agent.mode === "concierge"} onClick={() => save({ mode: "concierge" })}>
                🧑‍💼 Conserje — saluda, comparte menú y pasa a una persona
              </Chip>
              <Chip active={agent.mode === "orders"} onClick={() => save({ mode: "orders" })}>
                🛒 Órdenes — arma pedidos por WhatsApp
              </Chip>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 ts-caption text-muted-foreground">
              El bot central del portal también se edita acá. Los cambios se leen con cache de 5 minutos.
            </div>
          </Card>
          <Card padding="md" className="space-y-3">
            <CardHeader><CardTitle>Estado de conexión</CardTitle></CardHeader>
            <p className="ts-body text-muted-foreground">
              El vínculo de WhatsApp se administra desde <code>/admin/bots</code> (QR del relay). Este agente usa ese vínculo.
            </p>
            <Button variant="outline" size="sm" asChild><Link href="/admin/bots">Ver conexiones →</Link></Button>
          </Card>
        </div>
      )}

      {tab === "playground" && (
        <Card padding="md">
          <EmptyState
            title="Playground en preparación"
            hint="Vas a poder chatear con este agente sin enviar mensajes reales por WhatsApp. Se habilita en la Fase 2c."
          />
        </Card>
      )}

      {tab === "metrics" && (
        <Card padding="md">
          <p className="ts-body text-muted-foreground">
            Las métricas en vivo están en <Link href="/admin/bots" className="underline">/admin/bots</Link>: mensajes del día,
            derivaciones a persona y estado de conexión por agente. El resumen de tokens y costo del LLM está en la tarjeta “IA del bot” de ese mismo panel.
          </p>
        </Card>
      )}
    </div>
  );
}
