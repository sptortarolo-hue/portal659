"use client";

import { useState } from "react";

type ReviewFormProps = {
  vendorId: string;
  vendorName: string;
  onSubmitted?: () => void;
};

export function ReviewForm({ vendorId, vendorName, onSubmitted }: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !rating) return;
    setLoading(true);
    setError("");

    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendorId,
        customerName: name,
        rating,
        comment: comment || null,
      }),
    });

    const data = await res.json();
    if (data.error) {
      setError(data.error);
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
    onSubmitted?.();
  }

  if (done) {
    return (
      <div className="text-center py-4">
        <p className="text-lg font-medium">¡Gracias por tu reseña!</p>
        <p className="text-sm text-muted-foreground mt-1">
          Tu opinión ayuda al barrio.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm font-medium">
        ¿Cómo fue tu experiencia en {vendorName}?
      </p>

      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRating(star)}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            className={`text-2xl transition-all ${
              star <= (hover || rating)
                ? "scale-110 text-amber-400"
                : "text-muted-foreground hover:text-amber-300"
            }`}
          >
            {star <= (hover || rating) ? "★" : "☆"}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tu nombre"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background"
        required
      />

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Contanos más (opcional)"
        rows={2}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background resize-none"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={!rating || loading}
        className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? "Enviando..." : "Enviar reseña"}
      </button>
    </form>
  );
}
