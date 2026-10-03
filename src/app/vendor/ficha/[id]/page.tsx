"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { isAffirmative, type FormField } from "@/lib/ficha-templates";

function fmtAnswer(f: FormField, answers: Record<string, unknown>): string {
  const v = answers[f.id];
  if (v == null || v === "") return "—";
  if (f.type === "multiselect") {
    const arr = (Array.isArray(v) ? v : [v]).map(String).filter((x) => x !== "Otro");
    const other = answers[`${f.id}__other`];
    if (typeof other === "string" && other.trim()) arr.push(`Otra: ${other.trim()}`);
    return arr.length > 0 ? arr.join(", ") : "—";
  }
  if (f.type === "check") {
    const s = String(v) === "sí" ? "Sí" : "No";
    const d = answers[`${f.id}__detail`];
    return typeof d === "string" && d.trim() ? `${s} — ${d.trim()}` : s;
  }
  if (f.type === "photo") return "";
  if (f.type === "signature") return "";
  if (f.type === "consent") return "";
  return String(v);
}

/**
 * Ficha A4 para imprimir en papel (window.print) o guardar como PDF.
 * Membrete del local + respuestas por sección + fotos + firma.
 */
export default function FichaPrintPage() {
  const params = useParams();
  const id = String(params?.id || "");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [eRes, vRes] = await Promise.all([
          fetch(`/api/vendor/form-entries/${id}`).catch(() => null),
          fetch("/api/vendor/me").catch(() => null),
        ]);
        const eData = eRes?.ok ? await eRes.json().catch(() => ({})) : {};
        if (eData.error || !eData.entry) {
          setError(eData.error || "Ficha no encontrada");
          return;
        }
        const vendor = vRes?.ok ? (await vRes.json().catch(() => ({})))?.vendor : null;
        setData({ entry: eData.entry, vendor });
      } catch {
        setError("Error de conexión");
      }
    })();
  }, [id]);

  if (error) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-sm text-red-600">{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </main>
    );
  }

  const { entry, vendor } = data;
  const fields: FormField[] = Array.isArray(entry.template_fields) ? entry.template_fields : [];
  const answers: Record<string, unknown> =
    entry.answers && typeof entry.answers === "object" ? entry.answers : {};
  const photos: { field: FormField; urls: string[] }[] = fields
    .filter((f) => f.type === "photo")
    .map((f) => ({
      field: f,
      urls: (Array.isArray(answers[f.id]) ? (answers[f.id] as unknown[]) : []).map(String).slice(0, 6),
    }))
    .filter((p) => p.urls.length > 0);
  const signatureField = fields.find((f) => f.type === "signature");
  const signature =
    signatureField && typeof answers[signatureField.id] === "string"
      ? (answers[signatureField.id] as string)
      : "";
  const alerts = fields.filter((f) => f.alert && f.type === "check" && isAffirmative(answers[f.id]));

  return (
    <main className="min-h-screen bg-muted/40">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>

      <div className="no-print max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
        <a href="/vendor/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Volver al panel
        </a>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => window.print()}>🖨️ Imprimir</Button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto bg-white text-black rounded-xl sm:rounded-none p-8 mb-8 print:mb-0 print:rounded-none shadow print:shadow-none">
        <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold">{vendor?.store_name || ""}</h1>
            {vendor?.address && <p className="text-sm">{vendor.address}</p>}
            {(vendor?.phone || vendor?.whatsapp) && (
              <p className="text-sm">Tel: {vendor.phone || vendor.whatsapp}</p>
            )}
          </div>
          <div className="text-right text-sm">
            <p className="font-bold text-lg">📋 {entry.template_name || "Ficha"}</p>
            <p>Sesión N.º {entry.session_no}</p>
            <p>
              Fecha:{" "}
              {entry.created_at
                ? new Date(entry.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })
                : "—"}
            </p>
          </div>
        </div>

        {alerts.length > 0 && (
          <div className="border-2 border-black px-3 py-2 mb-4 text-sm font-bold">
            🚨 {alerts.map((f) => f.alertLabel || f.label).join(" · ")}
          </div>
        )}

        {fields.filter((f) => !["photo", "signature", "consent"].includes(f.type)).map((f) => {
          if (f.type === "section") {
            return (
              <h2 key={f.id} className="font-bold text-base mt-5 mb-2 border-b border-black pb-1">
                {f.label}
              </h2>
            );
          }
          return (
            <div key={f.id} className="flex gap-2 text-sm py-1 border-b border-neutral-200">
              <span className="font-medium w-52 flex-shrink-0">{f.label}:</span>
              <span className="flex-1">{fmtAnswer(f, answers)}</span>
            </div>
          );
        })}

        {photos.length > 0 && (
          <div className="mt-5">
            <h2 className="font-bold text-base mb-2 border-b border-black pb-1">Fotos</h2>
            {photos.map((p) => (
              <div key={p.field.id} className="mb-3">
                <p className="text-sm font-medium">{p.field.label}</p>
                <div className="flex gap-2 flex-wrap mt-1">
                  {p.urls.map((u, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={`${u}-${i}`} src={u} alt="" className="h-28 w-28 object-cover border border-neutral-300" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end justify-between gap-6 mt-8">
          <div className="flex-1">
            {signature ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={signature} alt="Firma" className="h-20 object-contain border-b border-black w-full" />
            ) : (
              <div className="h-20 border-b border-black" />
            )}
            <p className="text-xs mt-1">Firma de la clienta · registro interno del local</p>
          </div>
          <div className="text-xs text-right">
            <p>Estado: {entry.status === "complete" ? "Completa" : "Borrador"}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
