"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Review } from "@/types/database";

export function VendorReviews() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [replying, setReplying] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

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
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setReplying(r.id)}>
                Responder
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}