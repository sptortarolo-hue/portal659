"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { FormField, FormFieldType } from "@/lib/ficha-templates";

const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: "section", label: "Título de sección" },
  { value: "text", label: "Texto corto" },
  { value: "textarea", label: "Texto largo" },
  { value: "date", label: "Fecha" },
  { value: "scale", label: "Escala 0-10" },
  { value: "check", label: "No / Sí (+detalle)" },
  { value: "multiselect", label: "Varias opciones" },
  { value: "select-one", label: "Una opción" },
  { value: "photo", label: "Fotos" },
  { value: "signature", label: "Firma" },
  { value: "consent", label: "Texto legal" },
];

type Template = {
  id: string;
  name: string;
  service_ids: string[] | null;
  require_before: boolean | null;
  active: boolean | null;
  fields: FormField[];
};

type Preset = { key: string; name: string; description: string };

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "campo";

/** Constructor de modelos de ficha (estética): presets + editor de campos. */
export function FormTemplateManager({ onChanged }: { onChanged?: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [msg, setMsg] = useState("");
  // Alta.
  const [newName, setNewName] = useState("");
  const [newPreset, setNewPreset] = useState("");
  const [saving, setSaving] = useState(false);
  // Edición expandida.
  const [openId, setOpenId] = useState<string | null>(null);
  // Nuevo campo.
  const [fType, setFType] = useState<FormFieldType>("text");
  const [fLabel, setFLabel] = useState("");
  const [fOptions, setFOptions] = useState("");
  const [fRequired, setFRequired] = useState(false);
  const [fDetail, setFDetail] = useState(false);
  const [fAlert, setFAlert] = useState(false);
  const [fShowIf, setFShowIf] = useState("");
  const [fShowVal, setFShowVal] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [tRes, pRes, sRes] = await Promise.all([
        fetch("/api/vendor/form-templates").catch(() => null),
        fetch("/api/vendor/form-templates?presets=1").catch(() => null),
        fetch("/api/vendor/services").catch(() => null),
      ]);
      if (tRes) {
        const data = await tRes.json().catch(() => ({}));
        if (data.migrationMissing) setMissing(true);
        setTemplates(
          (data.templates || []).map((t: any) => ({
            ...t,
            service_ids: Array.isArray(t.service_ids) ? t.service_ids.map(String) : [],
            fields: Array.isArray(t.fields) ? t.fields : [],
          }))
        );
      }
      if (pRes?.ok) {
        const data = await pRes.json().catch(() => ({}));
        setPresets(data.presets || []);
      }
      if (sRes?.ok) {
        const data = await sRes.json().catch(() => ({}));
        setServices((data.services || []).map((s: any) => ({ id: String(s.id), name: String(s.name ?? "") })));
      }
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/vendor/form-templates/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) {
      setMsg(data.error);
      return null;
    }
    await load();
    onChanged?.();
    return data.template as Template;
  }

  async function create() {
    if (!newName.trim() && !newPreset) {
      setMsg("Poné un nombre o elegí una plantilla base");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/form-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          newPreset ? { preset: newPreset, ...(newName.trim() ? { name: newName.trim() } : {}) } : { name: newName.trim(), fields: [] }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setMsg(data.error);
        return;
      }
      setNewName("");
      setNewPreset("");
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`¿Borrar el modelo "${name}"? Se pierden sus sesiones cargadas.`)) return;
    try {
      await fetch(`/api/vendor/form-templates/${id}`, { method: "DELETE" });
      if (openId === id) setOpenId(null);
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    }
  }

  function resetFieldForm() {
    setFType("text");
    setFLabel("");
    setFOptions("");
    setFRequired(false);
    setFDetail(false);
    setFAlert(false);
    setFShowIf("");
    setFShowVal("");
  }

  async function addField(t: Template) {
    if (!fLabel.trim()) {
      setMsg("El campo necesita un título");
      return;
    }
    const base = slugify(fLabel);
    const taken = new Set(t.fields.map((f) => f.id));
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
    const field: FormField = { id, type: fType, label: fLabel.trim() };
    if (fRequired) field.required = true;
    if (fType === "multiselect" || fType === "select-one") {
      const opts = fOptions.split(",").map((o) => o.trim()).filter(Boolean).slice(0, 30);
      if (opts.length === 0) {
        setMsg("Poné las opciones separadas por coma");
        return;
      }
      field.options = opts;
      if (fType === "multiselect") field.allowOther = true;
    }
    if (fType === "check" && fDetail) {
      field.detail = true;
      field.detailLabel = "¿Cuál?";
    }
    if ((fType === "check" || fType === "select-one") && fAlert) {
      field.alert = true;
      field.alertLabel = "RIESGO";
    }
    if (fShowIf) {
      field.show_if = { field: fShowIf, equals: fShowVal.trim() || "sí" };
    }
    if (fType === "scale") {
      field.min = 0;
      field.max = 10;
    }
    if (fType === "photo") field.maxPhotos = 3;
    await patch(t.id, { fields: [...t.fields, field] });
    resetFieldForm();
  }

  async function moveField(t: Template, index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= t.fields.length) return;
    const next = [...t.fields];
    const [f] = next.splice(index, 1);
    next.splice(j, 0, f);
    await patch(t.id, { fields: next });
  }

  async function deleteField(t: Template, index: number) {
    const next = t.fields.filter((_, i) => i !== index);
    await patch(t.id, { fields: next });
  }

  async function toggleService(t: Template, serviceId: string) {
    const cur = t.service_ids || [];
    const next = cur.includes(serviceId) ? cur.filter((s) => s !== serviceId) : [...cur, serviceId];
    await patch(t.id, { service_ids: next });
  }

  if (missing) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Falta aplicar la migración <code>migrate-estetica-customer-forms.sql</code> en la base para modelos de ficha.
      </Card>
    );
  }

  const open = templates.find((t) => t.id === openId) || null;

  return (
    <Card className="p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">📋 Modelos de ficha</p>
        <p className="text-xs text-muted-foreground">
          Cada servicio puede tener su ficha (masajes, lifting…). Se llena por sesión y queda en la clienta.
        </p>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando...</p>
      ) : (
        templates.length > 0 && (
          <div className="space-y-1.5">
            {templates.map((t) => (
              <div key={t.id} className="rounded-lg bg-muted px-2.5 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(openId === t.id ? null : t.id);
                      resetFieldForm();
                    }}
                    className="flex-1 min-w-0 text-left"
                  >
                    <span className={`block font-medium truncate ${t.active === false ? "line-through opacity-60" : ""}`}>
                      {t.name} · {t.fields.length} campos
                    </span>
                    <span className="block text-muted-foreground truncate">
                      {(t.service_ids?.length || 0) === 0
                        ? "Todos los servicios"
                        : `${t.service_ids!.length} servicio(s)`}
                      {t.require_before ? " · se exige antes del turno" : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => patch(t.id, { active: !(t.active !== false) })}
                    className="text-muted-foreground hover:text-foreground flex-shrink-0"
                    title={t.active === false ? "Activar" : "Pausar"}
                  >
                    {t.active === false ? "▶️" : "⏸️"}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(t.id, t.name)}
                    className="text-red-600 hover:text-red-700 flex-shrink-0"
                    title="Borrar"
                  >
                    🗑️
                  </button>
                </div>
                {open?.id === t.id && (
                  <div className="mt-2 space-y-2 rounded-lg bg-background border border-border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium">Se adjunta a servicios</p>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                        <Switch checked={!!t.require_before} onCheckedChange={(v) => patch(t.id, { require_before: v })} />
                        Exigir antes del turno
                      </label>
                    </div>
                    {services.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">Sin servicios cargados: vale para todos.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => patch(t.id, { service_ids: [] })}
                          className={`px-2.5 py-1 rounded-full border text-[11px] ${(t.service_ids?.length || 0) === 0 ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"}`}
                        >
                          Todos
                        </button>
                        {services.map((s) => {
                          const on = (t.service_ids || []).includes(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => toggleService(t, s.id)}
                              className={`px-2.5 py-1 rounded-full border text-[11px] ${on ? "border-primary bg-primary/10 text-primary font-medium" : "border-border text-muted-foreground"}`}
                            >
                              {s.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="space-y-1">
                      {t.fields.map((f, i) => (
                        <div key={f.id} className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1.5">
                          <span className="flex-1 min-w-0 truncate">
                            {f.type === "section" ? `§ ${f.label}` : `${f.label} `}
                            <span className="text-muted-foreground">({f.type}{f.required ? ", *": ""}{f.show_if ? ", condicional" : ""}{f.alert ? ", 🚨" : ""})</span>
                          </span>
                          <button type="button" onClick={() => moveField(t, i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Subir">↑</button>
                          <button type="button" onClick={() => moveField(t, i, 1)} disabled={i === t.fields.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Bajar">↓</button>
                          <button type="button" onClick={() => deleteField(t, i)} className="text-red-600 hover:text-red-700" title="Borrar">✕</button>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-md border border-border p-2 space-y-2">
                      <p className="text-xs font-medium">＋ Agregar campo</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2">
                          <Label className="text-xs">Título</Label>
                          <Input value={fLabel} onChange={(e) => setFLabel(e.target.value)} placeholder="Ej: ¿Tiene alergias?" className="mt-1 h-9 text-sm" />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-xs">Tipo</Label>
                          <select
                            value={fType}
                            onChange={(e) => setFType(e.target.value as FormFieldType)}
                            className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                          >
                            {FIELD_TYPES.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        {(fType === "multiselect" || fType === "select-one") && (
                          <div className="col-span-2">
                            <Label className="text-xs">Opciones (separadas por coma)</Label>
                            <Input value={fOptions} onChange={(e) => setFOptions(e.target.value)} placeholder="Ej: Relajante, Descontracturante" className="mt-1 h-9 text-sm" />
                          </div>
                        )}
                        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input type="checkbox" checked={fRequired} onChange={(e) => setFRequired(e.target.checked)} className="h-4 w-4" />
                          Obligatorio
                        </label>
                        {fType === "check" && (
                          <>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                              <input type="checkbox" checked={fDetail} onChange={(e) => setFDetail(e.target.checked)} className="h-4 w-4" />
                              Pide detalle ("¿Cuál?")
                            </label>
                            <label className="flex items-center gap-1.5 text-xs cursor-pointer col-span-2">
                              <input type="checkbox" checked={fAlert} onChange={(e) => setFAlert(e.target.checked)} className="h-4 w-4" />
                              🚨 Alerta si responde Sí
                            </label>
                          </>
                        )}
                        <div className="col-span-2 grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Mostrar solo si el campo…</Label>
                            <select
                              value={fShowIf}
                              onChange={(e) => setFShowIf(e.target.value)}
                              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                            >
                              <option value="">Siempre visible</option>
                              {t.fields.filter((f) => f.type === "check" || f.type === "select-one").map((f) => (
                                <option key={f.id} value={f.id}>{f.label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label className="text-xs">…vale</Label>
                            <Input value={fShowVal} onChange={(e) => setFShowVal(e.target.value)} placeholder="sí" className="mt-1 h-9 text-sm" />
                          </div>
                        </div>
                      </div>
                      <Button size="sm" className="w-full" onClick={() => addField(t)}>
                        Agregar campo
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Nuevo modelo (nombre)</Label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ej: Ficha de uñas" className="mt-1 h-9 text-sm" />
        </div>
        <div>
          <Label className="text-xs">Desde plantilla</Label>
          <select
            value={newPreset}
            onChange={(e) => setNewPreset(e.target.value)}
            className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="">En blanco</option>
            {presets.map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      <Button size="sm" className="w-full" onClick={create} disabled={saving}>
        {saving ? "Creando..." : "＋ Crear modelo"}
      </Button>
    </Card>
  );
}
