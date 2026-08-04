"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type User = {
  id: string;
  email: string;
  name: string;
};

export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/");
  }

  return (
    <div className="flex items-center gap-4">
      {loading ? (
        <div className="w-20 h-8 bg-gray-100 rounded animate-pulse" />
      ) : user ? (
        <div className="flex items-center gap-3">
          <Link
            href="/vendor/dashboard"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Mi cuenta
          </Link>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cerrar sesión
          </button>
        </div>
      ) : (
        <>
          <Link
            href="/login"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            Iniciar sesión
          </Link>
          <Button asChild size="sm">
            <Link href="/register">Sumá tu comercio</Link>
          </Button>
        </>
      )}
    </div>
  );
}
