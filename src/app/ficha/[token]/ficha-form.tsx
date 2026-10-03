"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormRenderer } from "@/components/dashboard/form-renderer";
import type { FormField } from "@/lib/ficha-templates";

/** Formulario público de ficha (sin cuenta): borrador + completar con firma. */
export function FichaPublicForm({
  token,
  vendorId,
  fields,
  initialAnswers,
  initialStatus,
}: {
  token: string;
  vendorId: string;
  fields: FormField[];
  initialAnswers: Record<string, unknown>;
  initialStatus: string;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>(initialAnswers || {});
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState<"draft" | "complete" | null>(null);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState(initialStatus === "complete");

  // Requeridos visibles (respeta show_if en el render; acá chequeo simple).
  function missingRequired(): string[] {
    const missing: string[] = [];
    for (const f of fields) {
      if (f.type === "section" || !f.required) continue;
      const v = answers[f.id];
      const empty =
        v == null ||
        (typeof v === "string" && v.trim() === "") ||
        (Array.isArray(v) && v.length === 0);
      if (empty) missing.push(f.label);
    }
    return missing;
  }

  async function save(next: "draft" | "complete") {
    if (next === "complete") {
      const missing = missingRequired();
      if (missing.length > 0) {
        setMsg(`Faltan campos obligatorios: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`);
        return;
      }
    }
    setSaving(next);
    setMsg("");
    try {
      const res = await fetch(`/api/ficha/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.error || !data.ok) {
        setMsg(data.error || "No se pudo guardar");
        return;
      }
      setStatus(data.status);
      if (data.status === "complete") setDone(true);
      else setMsg("Borrador guardado ✅");
    } catch {
      setMsg("Error de conexión");
    } finally {
      setSaving(null);
    }
  }

  if (done && status === "complete") {
    return (
      <div className="text-center py-4">
        <p className="text-2xl mb-2">✅</p>
        <p className="font-medium">Ficha enviada</p>
        <p className="text-sm text-muted-foreground mt-1">Gracias, ya la tiene el local.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FormRenderer
        fields={fields}
        answers={answers}
        onChange={(id, v) => setAnswers((p) => ({ ...p, [id]: v }))}
        vendorId={vendorId}
      />
      {msg && <p className="text-sm text-red-600">{msg}</p>}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" disabled={saving !== null} onClick={() => save("draft")}>
          {saving === "draft" ? "Guardando..." : "Guardar borrador"}
        </Button>
        <Button className="flex-1" disabled={saving !== null} onClick={() => save("complete")}>
          {saving === "complete" ? "Enviando..." : "Enviar ficha"}
        </Button>
      </div>
    </div>
  );
}
