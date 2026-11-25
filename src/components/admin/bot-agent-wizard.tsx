"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Chip } from "@/components/panel-ui";
import { Button } from "@/components/ui/button";

type Template = { id: string; label: string; emoji: string; description: string; greeting: string; brief: Record<string, any> };
type Vendor = { id: string; store_name: string; vertical: string | null; slug: string | null };
type Model = { provider: string; model: string; label: string; tier: string; supportsTools: boolean };
type Brief = { instructions: string; business: string; products: string; audience: string; policies: string; always: string[]; never: string[] };
type Form = {
  name: string; greeting: string; tone: string; handoff_phone: string; brief: Brief;
  mode: "concierge" | "orders"; model: string; temperature: number; max_tokens: number; memory_limit: number; enabled: boolean;
};

const STEPS = ["Plantilla", "Comercio", "Identidad", "Esenciales", "Modelo"] as const;
const blankBrief: Brief = { instructions: "", business: "", products: "", audience: "", policies: "", always: [], never: [] };
const blank: Form = {
  name: "", greeting: "", tone: "humano", handoff_phone: "", brief: blankBrief,
  mode: "concierge", model: "", temperature: 0, max_tokens: 600, memory_limit: 16, enabled: true,
};

export function AgentWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [query, setQuery] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(blank);
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    fetch("/api/admin/bots/agents/available")
      .then((r) => r.json())
      .then((d) => {
        setTemplates((d.templates || []).filter((t: Template) => t.id !== "portal"));
        setVendors(d.vendors || []);
        setModels(d.models || []);
      })
      .catch(() => setError("No se pudieron cargar las plantillas"));
    setStep(0); setForm(blank); setNameTouched(false); setVendorId(""); setTemplateId(""); setError("");
  }, [open]);

  const chosen = useMemo(() => templates.find((t) => t.id === templateId) || null, [templates, templateId]);
  const filteredVendors = vendors.filter((v) => v.store_name.toLowerCase().includes(query.toLowerCase()));
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setBrief = (k: keyof Brief, v: string | string[]) => setForm((f) => ({ ...f, brief: { ...f.brief, [k]: v } }));
  const lines = (v: string[]) => (v || []).join("\n");
  const splitLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  function pickTemplate(t: Template) {
    setTemplateId(t.id);
    setForm((f) => ({
      ...f,
      greeting: t.greeting || f.greeting,
      brief: { ...blankBrief, ...t.brief, always: t.brief.always || [], never: t.brief.never || [] },
    }));
    setStep(1);
  }

  function pickVendor(v: Vendor) {
    setVendorId(v.id);
    set("name", nameTouched ? form.name : v.store_name);
    set("brief", { ...form.brief, business: `${v.store_name}${v.vertical ? ` · ${v.vertical}` : ""}` });
    setStep(2);
  }

  async function create() {
    if (!form.name.trim() || !form.greeting.trim()) { setError("Completá nombre y saludo"); return; }
    setSaving(true); setError("");
    try {
      const r = await fetch("/api/admin/bots/agents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId, ...form }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "No se pudo crear");
      onClose();
      router.push(`/admin/bots/agents/${encodeURIComponent(d.key)}`);
      router.refresh();
    } catch (e: any) { setError(e?.message || "No se pudo crear"); }
    finally { setSaving(false); }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-auto rounded-2xl border border-border bg-background p-4 space-y-3 ts-ui">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="ts-title">✨ Nuevo agente</h2>
            <p className="ts-caption text-muted-foreground">5 pasos · sin código y sin deploy</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>

        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <button key={s} onClick={() => i < step && setStep(i)} className="flex-1">
              <div className={`h-1.5 rounded-full ${i <= step ? "bg-primary" : "bg-muted"}`} />
              <span className={`ts-caption ${i === step ? "text-foreground font-medium" : "text-muted-foreground"}`}>{s}</span>
            </button>
          ))}
        </div>

        {error && <p className="ts-caption text-destructive">{error}</p>}

        {step === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {templates.map((t) => (
              <button key={t.id} onClick={() => pickTemplate(t)}
                className={`rounded-xl border p-3 text-left hover:bg-muted/50 ${chosen?.id === t.id ? "border-primary" : "border-border"}`}>
                <p className="ts-subtitle">{t.emoji} {t.label}</p>
                <p className="ts-caption text-muted-foreground">{t.description}</p>
              </button>
            ))}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-2">
            <p className="ts-body text-muted-foreground">Elegí el comercio al que va a atender este agente.</p>
            <input className="w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
              value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar comercio…" />
            <div className="max-h-64 space-y-1 overflow-auto">
              {filteredVendors.length === 0 && <p className="ts-caption text-muted-foreground">No hay comercios disponibles (o todos ya tienen agente).</p>}
              {filteredVendors.map((v) => (
                <button key={v.id} onClick={() => pickVendor(v)}
                  className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-left hover:bg-muted/50">
                  <span className="ts-body">{v.store_name}</span>
                  <Chip>{v.vertical || "comercio"}</Chip>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <Card padding="md" className="space-y-3">
            <label className="block ts-caption">Nombre del agente
              <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={form.name} onChange={(e) => { setNameTouched(true); set("name", e.target.value); }} />
            </label>
            <label className="block ts-caption">Saludo
              <textarea rows={3} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={form.greeting} onChange={(e) => set("greeting", e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block ts-caption">Tono
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                  value={form.tone} onChange={(e) => set("tone", e.target.value as Form["tone"])}>
                  <option value="humano">Humano (vos/tú)</option>
                  <option value="clasico">Clásico</option>
                </select>
              </label>
              <label className="block ts-caption">Teléfono de derivación
                <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                  value={form.handoff_phone} onChange={(e) => set("handoff_phone", e.target.value)} placeholder="Opcional" />
              </label>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card padding="md" className="space-y-3">
            <p className="ts-caption text-muted-foreground">Salieron de la plantilla «{chosen?.label || "comercio"}». Ajustalos con las palabras del negocio.</p>
            <label className="block ts-caption">Qué hace el agente
              <textarea rows={2} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={form.brief.instructions} onChange={(e) => setBrief("instructions", e.target.value)} />
            </label>
            <label className="block ts-caption">Productos / servicios
              <textarea rows={2} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={form.brief.products} onChange={(e) => setBrief("products", e.target.value)} />
            </label>
            <label className="block ts-caption">Público
              <input className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                value={form.brief.audience} onChange={(e) => setBrief("audience", e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block ts-caption">Siempre (una por línea)
                <textarea rows={3} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                  value={lines(form.brief.always)} onChange={(e) => setBrief("always", splitLines(e.target.value))} />
              </label>
              <label className="block ts-caption">Nunca (una por línea)
                <textarea rows={3} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                  value={lines(form.brief.never)} onChange={(e) => setBrief("never", splitLines(e.target.value))} />
              </label>
            </div>
          </Card>
        )}

        {step === 4 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card padding="md" className="space-y-3">
              <label className="block ts-caption">Modo
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                  value={form.mode} onChange={(e) => set("mode", e.target.value as Form["mode"])}>
                  <option value="concierge">🧑‍💼 Conserje — saluda y deriva</option>
                  <option value="orders">🛒 Órdenes — arma pedidos</option>
                </select>
              </label>
              <label className="block ts-caption">Modelo de IA
                <select className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 ts-body"
                  value={form.model} onChange={(e) => set("model", e.target.value)}>
                  <option value="">Predeterminado (rotación global)</option>
                  {models.map((m) => <option key={m.model} value={m.model}>{m.provider} · {m.label} [{m.tier}]</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 ts-caption">
                <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Crear activo
              </label>
            </Card>
            <Card padding="md" className="space-y-2">
              <p className="ts-caption font-medium">Resumen</p>
              <p className="ts-caption text-muted-foreground">Nombre: <span className="text-foreground">{form.name || "—"}</span></p>
              <p className="ts-caption text-muted-foreground">Plantilla: <span className="text-foreground">{chosen?.label || "—"}</span></p>
              <p className="ts-caption text-muted-foreground">Modo: <span className="text-foreground">{form.mode === "orders" ? "Órdenes" : "Conserje"}</span></p>
              <p className="ts-caption text-muted-foreground">Reglas: <span className="text-foreground">{form.brief.always.length} sí / {form.brief.never.length} no</span></p>
            </Card>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button variant="ghost" size="sm" disabled={step === 0} onClick={() => setStep(step - 1)}>← Atrás</Button>
          {step < 4 ? (
            <Button size="sm" onClick={() => setStep(step + 1)}
              disabled={(step === 0 && !templateId) || (step === 1 && !vendorId) || (step === 2 && !form.greeting.trim())}>Siguiente →</Button>
          ) : (
            <Button size="sm" onClick={create} disabled={saving}>{saving ? "Creando…" : "✨ Crear agente"}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
