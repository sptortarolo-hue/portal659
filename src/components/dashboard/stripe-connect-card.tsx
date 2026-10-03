"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Card "Cobrar con Stripe" (Connect por OAuth, espejo de MpConnectCard).
 * El comercio conecta su propia cuenta en un clic: los cobros online caen
 * directo en su Stripe, sin intermediarios.
 */
export function StripeConnectCard({
  stripeAccountId,
  stripeConnectedAt,
}: {
  stripeAccountId?: string | null;
  stripeConnectedAt?: string | null;
}) {
  const [disconnecting, setDisconnecting] = useState(false);
  const connected = !!stripeAccountId;
  const [oauthMsg, setOauthMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Llave maestra Stripe: sin `STRIPE_ENABLED=1` la card ni se muestra.
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/stripe/status")
      .then((r) => r.json())
      .then((d) => setStripeEnabled(d.enabled === true))
      .catch(() => setStripeEnabled(false));
  }, []);

  // Feedback del callback OAuth (?stripe=connected | ?stripe=error&reason=...).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const st = params.get("stripe");
    if (st === "connected") {
      setOauthMsg({ ok: true, text: "✅ ¡Cuenta de Stripe conectada! Ya podés cobrar señas con tarjeta." });
    } else if (st === "error") {
      const reason = params.get("reason");
      setOauthMsg({
        ok: false,
        text:
          reason === "state"
            ? "⚠️ La conexión expiró (más de 10 min). Probá de nuevo."
            : reason === "exchange"
              ? "⚠️ Stripe no devolvió los permisos. Probá de nuevo o revisá tu cuenta."
              : "⚠️ No se pudo conectar. Probá de nuevo.",
      });
    }
    if (st) {
      params.delete("stripe");
      params.delete("reason");
      const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
      window.history.replaceState(null, "", clean);
    }
  }, []);

  async function handleDisconnect() {
    if (!confirm("¿Desconectar Stripe? Tus clientes ya no podrán pagar con tarjeta hasta que lo vuelvas a conectar.")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/vendor/stripe/disconnect", { method: "POST" });
      if (res.ok) window.location.reload();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    stripeEnabled !== true ? null : (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-sm">💳 Cobrar con Stripe (tarjeta)</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Conectá tu cuenta de Stripe para cobrar señas con tarjeta: la plata cae{" "}
            <strong>directo en tu cuenta</strong>, sin intermediarios.
          </p>
        </div>
        {connected && (
          <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 text-[10px] font-bold px-2.5 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Conectado
          </span>
        )}
      </div>

      {connected ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-muted/60 p-3 text-xs flex items-center gap-2">
            <span className="text-lg">✅</span>
            <div>
              <p className="font-medium">Cuenta vinculada: <span className="font-mono">{String(stripeAccountId)}</span></p>
              {stripeConnectedAt && (
                <p className="text-muted-foreground mt-0.5">
                  Conectada el {new Date(stripeConnectedAt).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/10"
            disabled={disconnecting}
            onClick={handleDisconnect}
          >
            {disconnecting ? "Desconectando..." : "Desconectar"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
            <li>Tocás el botón de abajo.</li>
            <li>Se abre la página de Stripe (violeta).</li>
            <li>Iniciás sesión o creás tu cuenta y tocás "Conectar".</li>
            <li>Listo — quedó conectado, nadie te pide nada más.</li>
          </ol>
          <a href="/api/stripe/connect">
            <Button type="button" className="w-full bg-[#635BFF] hover:bg-[#4d44e0] text-white font-semibold">
              Conectar con Stripe
            </Button>
          </a>
          <p className="text-[10px] text-muted-foreground">
            El portal jamás ve ni guarda tu contraseña. Podés revocar esto en cualquier momento.
          </p>
        </div>
      )}
      {oauthMsg && (
        <p className={`text-xs rounded-lg px-3 py-2 ${oauthMsg.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-700"}`}>
          {oauthMsg.text}
        </p>
      )}
    </div>
    )
  );
}
