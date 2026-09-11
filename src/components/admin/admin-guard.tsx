"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000);
    fetch("/api/admin/auth-check", { signal: controller.signal })
      .then((r) => {
        if (r.status === 403) {
          setAllowed(false);
          router.push("/");
        } else if (!r.ok) {
          // 5xx: no redirigir en silencio — mostrar error con reintento.
          setError(true);
        } else {
          setAllowed(true);
        }
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => clearTimeout(id));
  }, [router]);

  if (error) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center space-y-4">
        <p className="font-semibold">No se pudo cargar el panel admin</p>
        <p className="text-sm text-muted-foreground">
          El servidor no respondió a la verificación de permisos. Revisá tu conexión o intentá de nuevo.
        </p>
        <Button onClick={() => window.location.reload()}>Reintentar</Button>
      </main>
    );
  }

  if (allowed === null) {
    return (
      <main className="container mx-auto px-4 py-20 max-w-md text-center">
        <p className="text-muted-foreground animate-pulse">Verificando permisos...</p>
      </main>
    );
  }

  if (!allowed) return null;

  return <>{children}</>;
}
