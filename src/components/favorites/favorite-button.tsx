"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/lib/toast";

type FavoriteButtonProps = {
  vendorId: string;
};

export function FavoriteButton({ vendorId }: FavoriteButtonProps) {
  const [isFav, setIsFav] = useState(false);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();

  useEffect(() => {
    fetch("/api/favorites")
      .then((r) => r.json())
      .then((data) => {
        const favs = data.favorites || [];
        setIsFav(favs.some((f: any) => f.vendor_id === vendorId));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [vendorId]);

  async function toggle() {
    const prev = isFav;
    setIsFav(!prev);

    const res = await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId }),
    });

    const data = await res.json();
    if (data.error) {
      setIsFav(prev);
      return;
    }

    setIsFav(data.favorited);
    addToast(data.favorited ? "Agregado a favoritos" : "Eliminado de favoritos");
  }

  if (loading) return null;

  return (
      <button
        onClick={toggle}
        className={`p-2 rounded-full transition-all ${
          isFav
            ? "text-red-500 hover:text-red-600 animate-pop-in"
            : "text-muted-foreground hover:text-red-400 active:scale-90"
        }`}
        title={isFav ? "Quitar de favoritos" : "Agregar a favoritos"}
      >
      <svg className="h-5 w-5" fill={isFav ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    </button>
  );
}
