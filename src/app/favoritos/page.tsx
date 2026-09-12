"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { VendorCard } from "@/components/store/vendor-card";
import { Button } from "@/components/ui/button";

type FavoriteRow = {
  vendor_id: string;
  vendors: {
    id: string;
    store_name: string;
    slug: string | null;
    logo_url?: string | null;
    image_url?: string | null;
    description?: string | null;
    vertical?: string | null;
    hours?: string | null;
    open_override?: boolean | null;
  };
};

export default function FavoritosPage() {
  const [favorites, setFavorites] = useState<FavoriteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  async function load() {
    try {
      const [meRes, favRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/favorites"),
      ]);
      const me = await meRes.json();
      setLoggedIn(!!me.user);
      const fav = await favRes.json();
      setFavorites(fav.favorites || []);
    } catch {
      setFavorites([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(vendorId: string) {
    await fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId }),
    });
    load();
  }

  if (loading) {
    return (
      <main className="container mx-auto px-4 py-10">
        <div className="bg-skeleton h-56 rounded-2xl" />
      </main>
    );
  }

  if (favorites.length === 0) {
    return (
      <main className="container mx-auto px-4 py-16 text-center max-w-md">
        <span className="text-4xl">🔖</span>
        <h1 className="font-display text-2xl font-semibold mt-3">
          Todavía no tenés favoritos
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {loggedIn === false
            ? "Tocá el corazón en cualquier comercio para guardarlo en este dispositivo, sin necesidad de cuenta."
            : "Tocá el corazón en cualquier comercio para guardarlo acá."}
        </p>
        <Button asChild className="mt-5">
          <Link href="/buscar">Explorar comercios</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-8 sm:py-12 max-w-6xl">
      <h1 className="font-display text-3xl font-semibold mb-6">
        {loggedIn === false ? "Tus favoritos" : "Mis favoritos"}
      </h1>

      {loggedIn === false && (
        <div className="mb-6 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
          Se guardan en <b>este dispositivo</b>.{" "}
          <Link href="/login" className="text-primary underline hover:text-primary/80">
            Iniciá sesión
          </Link>{" "}
          para que se sincronicen en todas tus visitas.
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {favorites.map((f) => (
          <div key={f.vendor_id} className="relative">
            <VendorCard
              id={f.vendors.id}
              slug={f.vendors.slug}
              store_name={f.vendors.store_name}
              image_url={f.vendors.image_url}
              logo_url={f.vendors.logo_url}
              description={f.vendors.description}
              vertical={f.vendors.vertical}
              hours={f.vendors.hours}
              open_override={f.vendors.open_override ?? null}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove(f.vendors.id)}
              className="absolute top-2 right-2 text-red-500 hover:text-red-600 hover:bg-red-50 z-10"
              aria-label={`Quitar ${f.vendors.store_name} de favoritos`}
            >
              Quitar
            </Button>
          </div>
        ))}
      </div>
    </main>
  );
}