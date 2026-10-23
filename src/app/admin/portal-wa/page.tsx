"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MessageCircle, ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";

type Status = {
  vendorId: string | null;
  linked: boolean;
  waPhone: string | null;
  status: string | null;
  enabled: boolean;
  ready?: boolean;
};

export default function PortalWaAdminPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/portal-wa");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "Error al cargar");
        setStatus(null);
      } else {
        setStatus(j as Status);
      }
    } catch {
      setError("Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function ensureAndLink() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/portal-wa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ensure" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || "No se pudo crear el número central");
        return;
      }
      const vendorId = j.vendorId;
      if (!vendorId) {
        setError("No se obtuvo el vendor central");
        return;
      }
      // Impersonar al vendor central (admin-as) y redirigir al flujo de Portal Wa Link.
      const sel = await fetch("/api/vendor/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId, as: true }),
      });
      if (!sel.ok) {
        setError("No se pudo impersonar al vendor central");
        return;
      }
      window.location.href = "/vendor/wa-bot";
    } catch {
      setError("Error de red");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Cargando...</p>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-lg font-bold">WhatsApp central de Portal 659</h1>
          <p className="text-xs text-muted-foreground">
            Número WA de la plataforma que envía los avisos a la logística (Portal 659 Envíos).
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>
      )}
      {msg && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">{msg}</div>
      )}

      {status?.ready === false && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Falta aplicar la migración <code>migrate-portal-wa.sql</code> en el contenedor de la DB.
        </div>
      )}

      <div className="rounded-xl border border-border bg-background p-4 space-y-3">
        <div className="flex items-center gap-2">
          {status?.linked ? (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          ) : (
            <AlertCircle className="h-5 w-5 text-amber-600" />
          )}
          <p className="text-sm font-bold">
            {status?.linked ? "Vinculado" : "No vinculado"}
          </p>
        </div>

        {status?.linked && (
          <div className="text-xs text-muted-foreground space-y-1">
            <p>📱 Número: <b>{status.waPhone || "—"}</b></p>
            <p>Estado: {status.status} · {status.enabled ? "habilitado" : "deshabilitado"}</p>
          </div>
        )}

        {!status?.linked && (
          <p className="text-xs text-muted-foreground">
            Vinculá un número WA de Portal 659 para que los avisos a la logística salgan automáticamente por ese número (en vez de requerir que el comercio abra WhatsApp manualmente).
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={ensureAndLink}>
            {busy ? "Creando..." : status?.linked ? "Re-vincular número" : "Vincular WhatsApp del Portal"}
          </Button>
          <Button size="sm" variant="outline" onClick={load} disabled={busy}>
            🔄 Recargar
          </Button>
        </div>

        {!status?.linked && (
          <p className="text-[11px] text-muted-foreground">
            Al hacer clic se crea el vendor central (si no existe) y se redirige al flujo de vinculación (escaneá el QR con el número central de Portal). Volvé a esta página después de vincular.
          </p>
        )}
      </div>
    </main>
  );
}
