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

  if (loggedIn === false) {
    return (
      <main className="container mx-auto px-4 py-16 text-center max-w-md">
        <span className="text-4xl">❤️</span>
        <h1 className="font-display text-2xl font-semibold mt-3">Tus favoritos</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Iniciá sesión para guardar tus comercios preferidos y volver a pedir con un toque.
        </p>
        <div className="flex gap-2 justify-center mt-5">
          <Button asChild>
            <Link href="/login">Iniciar sesión</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/register">Crear cuenta</Link>
          </Button>
        </div>
      </main>
    );
  }

  if (favorites.length === 0) {
    return (
      <main className="container mx-auto px-4 py-16 text-center max-w-md">
        <span className="text-4xl">🔖</span>
        <h1 className="font-display text-2xl font-semibold mt-3">Todavía no tenés favoritos</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Tocá el corazón en cualquier comercio para guardarlo acá.
        </p>
        <Button asChild className="mt-5">
          <Link href="/buscar">Explorar comercios</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-4 py-8 sm:py-12 max-w-6xl">
      <h1 className="font-display text-3xl font-semibold mb-6">Mis favoritos</h1>
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