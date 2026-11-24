"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, Chip, EmptyState, StatusDot } from "@/components/panel-ui";
import { Button } from "@/components/ui/button";

type FAQ = { id: string; question: string; answer: string; active: boolean };
type Brief = {
  instructions: string; business: string; products: string; audience: string;
  policies: string; always: string[]; never: string[];
};
type Form = { name: string; greeting: string; tone: string; handoff_phone: string; brief: Brief };
type Agent = {
  key: string; name: string; mode: string; enabled: boolean; tone: string;
  greeting: string | null; handoff_phone: string | null; store_name: string | null;
  link_status: string | null; wa_phone: string | null; brief: Record<string, unknown>;
  model: string | null;
  temperature: number;
  max_tokens: number;
  memory_limit: number;
};

const toForm = (a: Agent | null, def: any): Form => ({
  name: a?.name || def?.name || "",
  greeting: a?.greeting || def?.greeting || "",
  tone: a?.tone || "humano",
  handoff_phone: a?.handoff_phone || "",
  brief: {
    instructions: String(a?.brief?.instructions ?? def?.brief?.instructions ?? ""),
    business: String(a?.brief?.business ?? def?.brief?.business ?? ""),
    products: String(a?.brief?.products ?? def?.brief?.products ?? ""),
    audience: String(a?.brief?.audience ?? def?.brief?.audience ?? ""),
    policies: String(a?.brief?.policies ?? def?.brief?.policies ?? ""),
    always: (a?.brief?.always ?? def?.brief?.always ?? []) as string[],
    never: (a?.brief?.never ?? def?.brief?.never ?? []) as string[],
  },
});

function buildAgentBlock(form: Form, faqs: FAQ[]): string {
  const b = form.brief;
  const lines: string[] = [];
  const add = (title: string, text: string) => {
    const t = String(text || "").trim();
    if (t) lines.push(`### ${title}\n${t}`);
  };
  add("Tu trabajo", b.instructions);
  add("El negocio", [b.business, b.products, b.audience, b.policies].filter(Boolean).join("\n"));
  const rules = [
    ...(b.always || []).map((x) => `- SIEMPRE: ${x}`),
    ...(b.never || []).map((x) => `- NUNCA: ${x}`),
  ];
  if (rules.length) lines.push(`### Reglas\n${rules.join("\n")}`);
  const activeFaqs = faqs.filter((f) => f.active);
  if (activeFaqs.length) {
    lines.push(`### Conocimiento\n${activeFaqs.map((f) => `P: ${f.question}\nR: ${f.answer}`).join("\n\n")}`);
  }
  return lines.length ? `INFORMACIÓN DE ESTE AGENTE (${form.name || "comercio"}):\n${lines.join("\n\n")}` : "";
}

const TABS = [
  { id: "basics", label: "✏️ Básicos" },
  { id: "model", label: "🧠 Modelo" },
  { id: "playground", label: "💬 Playground" },
  { id: "lab", label: "🧪 Laboratorio" },
  { id: "knowledge", label: "📚 Conocimiento" },
  { id: "channel", label: "📱 Canal" },
  { id: "playground", label: "💬 Playground" },
  { id: "metrics", label: "📊 Métricas" },
] as const;
type Tab = typeof TABS[number]["id"];

export function BotAgentEditor({ agentKey }: { agentKey: string }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [basePrompt, setBasePrompt] = useState("");
  const [usingDefaults, setUsingDefaults] = useState(false);
  const [tab, setTab] = useState<Tab>("basics");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<{ provider: string; model: string; label: string; tier: string; supportsTools: boolean }[]>([]);
  const [modelTest, setModelTest] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "bot"; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSession] = useState(() => `s${Date.now()}`);
  const [labResult, setLabResult] = useState<any>(null);
  const [labRunning, setLabRunning] = useState(false);
  const [faqForm, setFaqForm] = useState({ question: "", answer: "" });

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}`);
    if (!r.ok) return;
    const d = await r.json();
    const a: Agent = d.agent;
    setAgent(a);
    setBasePrompt(d.basePrompt || "");
    setModels(d.models || []);
    const f = await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}/faqs`);
    setFaqs(f.ok ? (await f.json()).faqs || [] : []);
    const defR = await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}/defaults`);
    const defaults = defR.ok ? await defR.json() : null;
    const empty = !a.greeting && (!a.brief || Object.keys(a.brief).length === 0);
    setUsingDefaults(empty);
    setForm(toForm(empty ? null : a, defaults));
  }, [agentKey]);
  useEffect(() => { load(); }, [load]);

  const preview = useMemo(() => (form ? buildAgentBlock(form, faqs) : ""), [form, faqs]);

  async function patch(body: Record<string, unknown>, successMsg = "Guardado ✓") {
    setSaving(true); setMsg("");
    try {
      const r = await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "No se pudo guardar");
      setMsg(successMsg);
      await load();
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

  if (!agent || !form) return <Card padding="md"><p className="ts-body text-muted-foreground">Cargando agente…</p></Card>;

  const setField = (key: keyof Form, value: string) => setForm({ ...form, [key]: value });
  const setBrief = (key: keyof Brief, value: string | string[]) => setForm({ ...form, brief: { ...form.brief, [key]: value } });
  const lines = (v: string[]) => (v || []).join("\n");
  const splitLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

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
              <input type="checkbox" checked={agent.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
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
            <CardHeader>
              <CardTitle>Identidad</CardTitle>
              {usingDefaults && <Chip active>Config por defecto (no guardada)</Chip>}
            </CardHeader>
            <label className="block ts-caption">Nombre
              <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={form.name} onChange={(e) => setField("name", e.target.value)} />
            </label>
            <label className="block ts-caption">Saludo
              <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body" rows={3}
                value={form.greeting} onChange={(e) => setField("greeting", e.target.value)} />
            </label>
            <label className="block ts-caption">Tono
              <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={form.tone} onChange={(e) => setField("tone", e.target.value)}>
                <option value="humano">Humano (vos/tú)</option>
                <option value="clasico">Clásico</option>
              </select>
            </label>
            <label className="block ts-caption">Teléfono de derivación
              <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={form.handoff_phone} placeholder="5491100000000"
                onChange={(e) => setField("handoff_phone", e.target.value)} />
            </label>
          </Card>

          <Card padding="md" className="space-y-3">
            <CardHeader><CardTitle>Brief del negocio</CardTitle></CardHeader>
            <label className="block ts-caption">Qué hace el negocio
              <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body" rows={2}
                value={form.brief.instructions} onChange={(e) => setBrief("instructions", e.target.value)} />
            </label>
            <label className="block ts-caption">Productos / servicios
              <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body" rows={2}
                value={form.brief.products} onChange={(e) => setBrief("products", e.target.value)} />
            </label>
            <label className="block ts-caption">Público
              <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={form.brief.audience} onChange={(e) => setBrief("audience", e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block ts-caption">Siempre (una por línea)
                <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body" rows={3}
                  value={lines(form.brief.always)} onChange={(e) => setBrief("always", splitLines(e.target.value))} />
              </label>
              <label className="block ts-caption">Nunca (una por línea)
                <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body" rows={3}
                  value={lines(form.brief.never)} onChange={(e) => setBrief("never", splitLines(e.target.value))} />
              </label>
            </div>
          </Card>

          <Card padding="md" className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Prompt real del bot</CardTitle>
              <div className="flex gap-2">
                <Button size="sm" disabled={saving} onClick={() => patch({
                  name: form.name, greeting: form.greeting, tone: form.tone,
                  handoff_phone: form.handoff_phone, brief: form.brief,
                }, "Cambios guardados ✓")}>{saving ? "Guardando…" : "💾 Guardar cambios"}</Button>
                <Button variant="outline" size="sm" onClick={async () => {
                  await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}/defaults`, { method: "POST" });
                  await load();
                }}>↺ Restaurar defaults</Button>
              </div>
            </CardHeader>
            <p className="ts-caption text-muted-foreground mb-2">
              🔒 motor fijo (no editable) · ✏️ config del agente (en vivo). Total: {(basePrompt.length + preview.length).toLocaleString("es-AR")} caracteres.
            </p>
            <details className="mb-2 rounded-lg bg-muted/40 p-2">
              <summary className="ts-caption cursor-pointer">🔒 Motor fijo — {basePrompt.length.toLocaleString("es-AR")} caracteres (ver)</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-background p-3 ts-caption text-muted-foreground max-h-56 overflow-auto">{basePrompt || "(no disponible)"}</pre>
            </details>
            <div className="rounded-lg bg-muted/50 p-2">
              <p className="ts-caption font-medium mb-1">✏️ Configuración del agente — {preview.length.toLocaleString("es-AR")} caracteres</p>
              <pre className="whitespace-pre-wrap rounded-lg bg-background p-3 ts-caption text-foreground max-h-64 overflow-auto">
                {preview || "(sin configuración — el bot usa solo el motor fijo)"}
              </pre>
            </div>
          </Card>
        </div>
      )}

      {tab === "model" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card padding="md" className="space-y-3">
            <CardHeader><CardTitle>Proveedor y modelo</CardTitle></CardHeader>
            <p className="ts-body text-muted-foreground">
              Elegí con qué IA responde este agente. Los proveedores usan las llaves configuradas en el servidor.
              Si el modelo falla o se queda sin cuota, el bot cae al siguiente proveedor y, si no queda ninguno, a reglas.
            </p>
            <label className="block ts-caption">Modelo
              <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={agent.model || ""} onChange={(e) => patch({ model: e.target.value || null })}>
                <option value="">Predeterminado (rotación global)</option>
                {models.map((m) => (
                  <option key={m.model} value={m.model}>
                    {m.provider} · {m.label} [{m.tier}]{!m.supportsTools ? " — sin tools" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-1">
              {models.filter((m) => !agent.model || m.model === agent.model).map((m) => (
                <Chip key={m.model} active>{m.tier}</Chip>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={!agent.model || saving}
                onClick={async () => {
                  setModelTest("Probando…");
                  const r = await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}/test-model`, {
                    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: agent.model }),
                  });
                  const d = await r.json().catch(() => ({}));
                  setModelTest(d.ok ? `✅ HTTP ${d.status} · ${d.latencyMs}ms · ${d.reply ? `respondió "${d.reply}"` : "sin contenido"}${d.note ? ` · ${d.note}` : ""}` : `❌ ${d.error || `HTTP ${d.status || "?"}`}`);
                }}>▶ Probar modelo</Button>
              {modelTest && <span className="ts-caption text-muted-foreground">{modelTest}</span>}
            </div>
          </Card>

          <Card padding="md" className="space-y-3">
            <CardHeader><CardTitle>Ajustes de generación</CardTitle></CardHeader>
            <label className="block ts-caption">Temperatura ({Number(agent.temperature ?? 0).toFixed(2)})
              <input type="range" min={0} max={1} step={0.1} className="mt-1 w-full"
                value={Number(agent.temperature ?? 0)}
                onChange={(e) => setAgent({ ...agent, temperature: Number(e.target.value) })}
                onMouseUp={() => patch({ temperature: Number(agent.temperature) })}
                onTouchEnd={() => patch({ temperature: Number(agent.temperature) })} />
            </label>
            <label className="block ts-caption">Tokens máximos por respuesta
              <input type="number" min={100} max={4000} step={100} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={agent.max_tokens ?? 600}
                onChange={(e) => setAgent({ ...agent, max_tokens: Number(e.target.value) })}
                onBlur={() => patch({ max_tokens: Number(agent.max_tokens) })} />
            </label>
            <label className="block ts-caption">Mensajes de memoria (0 = sin historial)
              <input type="number" min={0} max={100} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={agent.memory_limit ?? 16}
                onChange={(e) => setAgent({ ...agent, memory_limit: Number(e.target.value) })}
                onBlur={() => patch({ memory_limit: Number(agent.memory_limit) })} />
            </label>
            <p className="ts-caption text-muted-foreground">
              Temperatura 0 = respuestas deterministas (recomendado para pedidos). Subirla hace el bot más creativo pero menos predecible.
            </p>
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
            <p className="ts-body text-muted-foreground">Elegí qué hace el bot cuando le escriben. Sin código ni deploy.</p>
            <div className="flex flex-wrap gap-2">
              <Chip active={agent.mode === "concierge"} onClick={() => patch({ mode: "concierge" })}>
                🧑‍💼 Conserje — saluda, comparte menú y pasa a una persona
              </Chip>
              <Chip active={agent.mode === "orders"} onClick={() => patch({ mode: "orders" })}>
                🛒 Órdenes — arma pedidos por WhatsApp
              </Chip>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 ts-caption text-muted-foreground">
              El bot central del portal también se edita acá. Los cambios se leen con cache de 5 minutos.
            </div>
          </Card>
          <Card padding="md" className="space-y-3">
            <CardHeader><CardTitle>Estado de conexión</CardTitle></CardHeader>
            <div className="flex items-center gap-2">
              <StatusDot tone={(agent.link_status === "linked" ? "success" : agent.enabled ? "warning" : "neutral") as any} />
              <span className="ts-body">
                {agent.link_status === "linked" ? "WhatsApp vinculado" : agent.link_status === "pairing" ? "Pareando (esperando QR)" : "Sin vincular"}
              </span>
            </div>
            {agent.wa_phone && <p className="ts-caption text-muted-foreground">Número: {agent.wa_phone}</p>}
            <p className="ts-body text-muted-foreground">
              El vínculo se administra desde <code>/admin/bots</code> (QR del relay). Este agente usa ese vínculo.
            </p>
            <Button variant="outline" size="sm" asChild><Link href="/admin/bots">Gestionar conexión →</Link></Button>
          </Card>
        </div>
      )}

      {tab === "playground" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card padding="md" className="lg:col-span-2 space-y-3">
            <CardHeader>
              <CardTitle>Chat de prueba</CardTitle>
              <Button variant="outline" size="sm" onClick={() => {
                setChat([]);
                fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}/playground?sessionId=${chatSession}`, { method: "DELETE" }).catch(() => {});
              }}>🧹 Nueva sesión</Button>
            </CardHeader>
            <div className="space-y-2 max-h-[420px] overflow-auto rounded-lg bg-muted/30 p-3">
              {chat.length === 0 && <p className="ts-caption text-muted-foreground">Escribí como si fueras un cliente. No se envía nada por WhatsApp.</p>}
              {chat.map((m, i) => (
                <div key={i} className={`rounded-lg px-3 py-2 ts-body whitespace-pre-wrap ${m.role === "user" ? "ml-auto bg-primary text-primary-foreground max-w-[80%]" : "mr-auto bg-background max-w-[85%]"}`}>
                  {m.text}
                </div>
              ))}
            </div>
            <form className="flex gap-2" onSubmit={async (e) => {
              e.preventDefault();
              const msg = chatInput.trim();
              if (!msg || saving) return;
              setChatInput(""); setChat((c) => [...c, { role: "user", text: msg }]); setSaving(true);
              try {
                const r = await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}/playground`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sessionId: chatSession, message: msg }),
                });
                const d = await r.json().catch(() => ({}));
                setChat((c) => [...c, { role: "bot", text: (d.replies || []).join("\n") || "(sin respuesta)" }]);
              } catch { setChat((c) => [...c, { role: "bot", text: "Error al llamar al motor" }]); }
              finally { setSaving(false); }
            }}>
              <input className="flex-1 rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Hola, quiero pedir…" />
              <Button size="sm" type="submit" disabled={saving || !chatInput.trim()}>{saving ? "…" : "Enviar"}</Button>
            </form>
          </Card>
          <Card padding="md" className="space-y-2">
            <CardHeader><CardTitle>Cómo funciona</CardTitle></CardHeader>
            <p className="ts-body text-muted-foreground">
              Este chat usa el <strong>mismo motor</strong> que atiende por WhatsApp, con la config y el modelo de este agente.
              Está en <strong>sandbox</strong>: no envía mensajes, no crea pedidos reales y no contamina métricas ni conversaciones de clientes.
            </p>
            <p className="ts-caption text-muted-foreground">Sesión: <code>{chatSession}</code></p>
          </Card>
        </div>
      )}

      {tab === "lab" && (
        <div className="space-y-3">
          <Card padding="md" className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="ts-subtitle">Simulación con 6 clientes</p>
              <p className="ts-body text-muted-foreground">
                Clientes con personalidades distintas conversan contra el agente real (en sandbox) y un juez LLM los puntúa 0-100.
              </p>
            </div>
            <Button size="sm" disabled={labRunning} onClick={async () => {
              setLabRunning(true); setMsg("");
              try {
                const r = await fetch(`/api/admin/bots/agents/${encodeURIComponent(agentKey)}/lab`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sessionId: chatSession, judgeEnabled: true }),
                });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(d?.error || "No se pudo correr");
                setLabResult(d);
                setMsg(`Simulación lista: ${d.passed}/${d.total} personas OK`);
              } catch (e: any) { setMsg(`Error: ${e?.message || "falló"}`); }
              finally { setLabRunning(false); }
            }}>{labRunning ? "Corriendo…" : "▶ Correr simulación (6 clientes)"}</Button>
          </Card>
          {msg && <p className="ts-caption text-muted-foreground">{msg}</p>}
          {labResult && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {labResult.results?.map((r: any) => (
                <Card key={r.id} padding="md" className="space-y-2">
                  <CardHeader>
                    <CardTitle>{r.ok ? "✅" : "⚠️"} {r.name}</CardTitle>
                    <Chip active={r.ok}>{r.total}/100</Chip>
                  </CardHeader>
                  <p className="ts-caption text-muted-foreground">{r.heuristic?.note}</p>
                  {r.verdict && (
                    <div className="rounded-lg bg-muted/40 p-2">
                      <p className="ts-caption font-medium">Juez: score {r.verdict.score} · alucina: {r.verdict.hallucination ? "sí" : "no"} · escala bien: {r.verdict.escalation_correct ? "sí" : "no"}</p>
                      {(r.verdict.findings || []).map((f: string, i: number) => <p key={i} className="ts-caption text-muted-foreground">• {f}</p>)}
                    </div>
                  )}
                  <details className="ts-caption">
                    <summary className="cursor-pointer text-muted-foreground">Ver conversación</summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-background p-2 text-[11px] max-h-48 overflow-auto">
                      {r.transcript.map((t: any) => `CLIENTE: ${t.user}\nBOT: ${t.bot}`).join("\n\n")}
                    </pre>
                  </details>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "metrics" && (
        <Card padding="md">
          <p className="ts-body text-muted-foreground">
            Métricas en vivo en <Link href="/admin/bots" className="underline">/admin/bots</Link>: mensajes del día,
            derivaciones y conexión por agente. Tokens y costo del LLM en la tarjeta “IA del bot” de ese panel.
          </p>
        </Card>
      )}
    </div>
  );
}
