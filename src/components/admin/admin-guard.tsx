"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/admin")
      .then((r) => {
        if (r.status === 403) {
          setAllowed(false);
          router.push("/");
        } else {
          setAllowed(true);
        }
      })
      .catch(() => {
        setAllowed(false);
        router.push("/");
      });
  }, [router]);

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
