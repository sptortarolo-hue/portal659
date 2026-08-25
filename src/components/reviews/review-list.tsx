"use client";

import { useEffect, useState } from "react";
import type { Review } from "@/types/database";

type ReviewListProps = {
  vendorId: string;
};

export function ReviewList({ vendorId }: ReviewListProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/reviews?vendor_id=${vendorId}`)
      .then((r) => r.json())
      .then((data) => {
        setReviews(data.reviews || []);
        setAvgRating(data.avgRating || 0);
        setCount(data.count || 0);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [vendorId]);

  if (loading) return null;
  if (count === 0) return null;

  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
    pct: count > 0 ? (reviews.filter((r) => r.rating === star).length / count) * 100 : 0,
  }));

  return (
    <div className="border border-border rounded-2xl p-6 bg-card mt-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <div className="text-center sm:text-left">
          <div className="text-4xl font-bold">{avgRating.toFixed(1)}</div>
          <div className="flex gap-0.5 justify-center sm:justify-start mt-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <span key={star} className={`text-lg ${star <= Math.round(avgRating) ? "text-amber-400" : "text-muted"}`}>
                ★
              </span>
            ))}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {count} reseña{count !== 1 ? "s" : ""}
          </p>
        </div>

        {/* Distribution bars */}
        <div className="flex-1 space-y-1.5">
          {distribution.map((d) => (
            <div key={d.star} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-3 text-right">{d.star}</span>
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${d.pct}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground w-6 text-right">{d.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Reviews */}
      <div className="space-y-4">
        {reviews.map((r) => (
          <div key={r.id} className="border-b border-border last:border-0 pb-3 last:pb-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex gap-0.5 text-sm text-amber-400">
                {[1, 2, 3, 4, 5].map((star) => (
                  <span key={star}>{star <= r.rating ? "★" : "☆"}</span>
                ))}
              </span>
              <span className="text-sm font-medium">{r.customer_name}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleDateString("es-AR", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </div>
            {r.comment && (
              <p className="text-sm text-muted-foreground">{r.comment}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
