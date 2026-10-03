"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormRenderer } from "@/components/dashboard/form-renderer";
import { triggeredAlerts, type FormField } from "@/lib/ficha-templates";

type Template = {
  id: string;
  name: string;
  fields: FormField[];
};

type Entry = {
  id: string;
  template_id: string;
  template_name?: string;
  customer_phone: string;
  booking_id: string | null;
  answers: Record<string, unknown>;
  session_no: number;
  status: string;
  public_token: string | null;
  created_at: string;
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/**
 * Fichas dinámicas por clienta (timeline por modelo + carga de sesiones).
 * Vive dentro de la ficha expandida de Clientes (serviceMode).
 */
export function CustomerFormTimeline({
  vendorId,
  phone,
  onChanged,
}: {
  vendorId?: string | null;
  phone: string;
  onChanged?: () => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  // Entry abierta en edición.
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [tRes, eRes] = await Promise.all([
        fetch("/api/vendor/form-templates?active=1").catch(() => null),
        fetch(`/api/vendor/form-entries?phone=${encodeURIComponent(phone)}`).catch(() => null),
      ]);
      if (tRes?.ok) {
        const data = await tRes.json().catch(() => ({}));
        setTemplates(
          (data.templates || []).map((t: any) => ({
            id: String(t.id),
            name: String(t.name ?? ""),
            fields: Array.isArray(t.fields) ? t.fields : [],
          }))
        );
      }
      if (eRes?.ok) {
        const data = await eRes.json().catch(() => ({}));
        setEntries(
          (data.entries || []).map((e: any) => ({
            ...e,
            answers: e.answers && typeof e.answers === "object" ? e.answers : {},
          }))
        );
      }
    } catch {
      /* sin migración: vacío */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  async function newSession(templateId: string) {
    setCreating(templateId);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/form-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId, customer_phone: phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error || !data.entry) {
        setMsg(data.error || "No se pudo crear");
        return;
      }
      await load();
      setOpenId(String(data.entry.id));
      setDraft({});
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setCreating(null);
    }
  }

  async function saveEntry(entry: Entry, status: "draft" | "complete") {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch(`/api/vendor/form-entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: draft, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setMsg(data.error);
        return;
      }
      if (status === "complete") setOpenId(null);
      await load();
      onChanged?.();
    } catch {
      setMsg("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  function openEntry(entry: Entry) {
    if (openId === entry.id) {
      setOpenId(null);
      return;
    }
    setOpenId(entry.id);
    setDraft({ ...(entry.answers || {}) });
  }

  if (loading) return <p className="text-xs text-muted-foreground">Cargando fichas...</p>;
  if (templates.length === 0) return null;

  const tplById = new Map(templates.map((t) => [t.id, t]));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">📋 Fichas por sesión</p>
        <div className="flex gap-1.5 flex-wrap">
          {templates.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={creating === t.id}
              onClick={() => newSession(t.id)}
            >
              {creating === t.id ? "..." : `＋ ${t.name}`}
            </Button>
          ))}
        </div>
      </div>
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin sesiones cargadas. Creá la primera con ＋.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e) => {
            const tpl = tplById.get(e.template_id);
            const fields = tpl?.fields || [];
            const alerts = triggeredAlerts(fields, e.answers || {});
            const isOpen = openId === e.id;
            return (
              <div key={e.id} className="rounded-lg border border-border overflow-hidden">
                <button
                  type="button"
                  onClick={() => openEntry(e)}
                  className="w-full text-left px-2.5 py-2 flex items-center gap-2"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-xs font-medium truncate">
                      {e.template_name || tpl?.name || "Ficha"} · Sesión {e.session_no} · {fmtDate(e.created_at)}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {e.status === "complete" ? "✅ Completa" : "📝 Borrador"}
                      {alerts.length > 0 && ` · 🚨 ${alerts.map((a) => a.label).join(", ")}`}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs flex-shrink-0">{isOpen ? "▾" : "▸"}</span>
                </button>
                {isOpen && (
                  <div className="border-t border-border px-2.5 py-3 space-y-3">
                    {alerts.length > 0 && (
                      <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-800">
                        🚨 {alerts.map((a) => a.label).join(" · ")}
                      </div>
                    )}
                    <FormRenderer
                      fields={fields}
                      answers={draft}
                      onChange={(id, v) => setDraft((p) => ({ ...p, [id]: v }))}
                      vendorId={vendorId}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" disabled={saving} onClick={() => saveEntry(e, "draft")}>
                        Guardar borrador
                      </Button>
                      <Button size="sm" className="flex-1" disabled={saving} onClick={() => saveEntry(e, "complete")}>
                        {saving ? "Guardando..." : "Completar y firmar"}
                      </Button>
                      <a href={`/vendor/ficha/${e.id}`} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline">🖨️</Button>
                      </a>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
