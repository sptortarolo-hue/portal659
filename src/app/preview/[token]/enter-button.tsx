"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LayoutDashboard } from "lucide-react";

/** Crea la sesión de prueba del panel y entra al dashboard (sin cuenta). */
export function PreviewDashboardButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function enter() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/preview/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setError(data.error || "No se pudo ingresar al panel de prueba");
        return;
      }
      router.push("/vendor/dashboard");
    } catch {
      setError("Error de conexión");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" className="w-full" onClick={enter} disabled={busy}>
        <LayoutDashboard className="h-4 w-4 mr-2" />
        {busy ? "Ingresando…" : "Probar el panel del comercio"}
      </Button>
      {error && <p className="text-xs text-red-600 text-center">{error}</p>}
      <p className="text-[11px] text-muted-foreground text-center">
        Acceso temporal de prueba, sin cuenta. Se revoca con el link.
      </p>
    </div>
  );
}
