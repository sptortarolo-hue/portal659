"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Flag } from "lucide-react";
import type { Review } from "@/types/database";

export function VendorReviews() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [replying, setReplying] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportSaving, setReportSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/reviews");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudieron cargar las reseñas");
        setReviews([]);
      } else {
        setReviews(data.reviews || []);
      }
    } catch {
      setError("No se pudieron cargar las reseñas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveReply(review: Review) {
    const text = draft.trim();
    if (!text) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/vendor/reviews/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo guardar la respuesta");
        return;
      }
      setReplying(null);
      setDraft("");
      load();
    } catch {
      setError("No se pudo guardar la respuesta");
    } finally {
      setSaving(false);
    }
  }

  async function submitReport(reviewId: string) {
    const reason = reportReason.trim();
    if (!reason) return;
    setReportSaving(true);
    try {
      const res = await fetch(`/api/vendor/reviews/${reviewId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo reportar la reseña");
        return;
      }
      setReporting(null);
      setReportReason("");
      load();
    } catch {
      setError("No se pudo reportar la reseña");
    } finally {
      setReportSaving(false);
    }
  }

  if (loading) {
    return <div className="bg-skeleton h-40 rounded-2xl" />;
  }

  if (error) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load}>Reintentar</Button>
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl p-8 text-center">
        <span className="text-3xl">⭐</span>
        <p className="font-display text-lg font-semibold mt-2">Todavía no tenés reseñas</p>
        <p className="text-sm text-muted-foreground mt-1">
          Cuando tus clientes dejen una reseña, vas a poder responderla acá y mostrarla en tu vidriera.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-display text-xl font-semibold mb-4">Reseñas</h2>
      <div className="space-y-3">
        {reviews.map((r) => (
          <div key={r.id} className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center gap-2">
              <span className="flex gap-0.5 text-sm text-amber-400">
                {[1, 2, 3, 4, 5].map((star) => (
                  <span key={star}>{star <= r.rating ? "★" : "☆"}</span>
                ))}
              </span>
              <span className="text-sm font-medium">{r.customer_name}</span>
              {r.reported && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-600">
                  <Flag className="h-3 w-3" />
                  Reportada
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {new Date(r.created_at).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            </div>
            {r.comment && <p className="text-sm text-muted-foreground mt-2">{r.comment}</p>}

            {r.reply ? (
              <div className="mt-3 rounded-xl bg-primary/5 border border-primary/10 p-3">
                <p className="text-xs font-medium text-primary mb-1">Tu respuesta · {r.replied_at ? new Date(r.replied_at).toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : ""}</p>
                <p className="text-sm">{r.reply}</p>
                <button
                  onClick={() => { setReplying(r.id); setDraft(r.reply || ""); }}
                  className="text-xs text-primary hover:underline mt-2"
                >
                  Editar respuesta
                </button>
              </div>
            ) : replying === r.id ? (
              <div className="mt-3">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Respondé públicamente a esta reseña…"
                  rows={3}
                  className="w-full rounded-xl border border-border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <div className="flex gap-2 mt-2">
                  <Button size="sm" onClick={() => saveReply(r)} disabled={saving || !draft.trim()}>
                    {saving ? "Guardando…" : "Publicar respuesta"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setReplying(null); setDraft(""); }}>Cancelar</Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mt-3">
                <Button variant="outline" size="sm" onClick={() => setReplying(r.id)}>
                  Responder
                </Button>
                {!r.reported && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setReporting(r.id); setReportReason(""); }}
                    className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                  >
                    <Flag className="h-3.5 w-3.5 mr-1" />
                    Reportar
                  </Button>
                )}
              </div>
            )}

            {reporting === r.id && (
              <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs font-medium text-orange-800 mb-2">¿Por qué reportás esta reseña?</p>
                <textarea
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  placeholder="Ej: contenido ofensivo, spam, reseña falsa…"
                  rows={2}
                  maxLength={500}
                  className="w-full rounded-lg border border-orange-200 bg-white p-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
                <div className="flex gap-2 mt-2">
                  <Button
                    size="sm"
                    onClick={() => submitReport(r.id)}
                    disabled={reportSaving || !reportReason.trim()}
                    className="bg-orange-600 hover:bg-orange-700"
                  >
                    {reportSaving ? "Enviando…" : "Enviar reporte"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setReporting(null); setReportReason(""); }}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}