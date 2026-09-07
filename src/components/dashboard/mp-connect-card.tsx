"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Card "Cobrar con Mercado Pago" (multi-market por OAuth).
 * El comercio conecta su propia cuenta en un clic: el OAuth se encarga del resto.
 */
export function MpConnectCard({
  mpUserId,
  mpConnectedAt,
}: {
  mpUserId?: number | null;
  mpConnectedAt?: string | null;
}) {
  const [disconnecting, setDisconnecting] = useState(false);
  const connected = !!mpUserId;

  async function handleDisconnect() {
    if (!confirm("¿Desconectar Mercado Pago? Tus clientes ya no podrán pagar online hasta que lo vuelvas a conectar.")) return;
    setDisconnecting(true);
    try {
      const res = await fetch("/api/vendor/mp/disconnect", { method: "POST" });
      if (res.ok) window.location.reload();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-sm">💳 Cobrar con Mercado Pago</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Conectá tu cuenta de Mercado Pago para que tus clientes te paguen online
            y la plata caiga <strong>directo en tu cuenta</strong>, sin intermediarios.
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
              <p className="font-medium">Cuenta vinculada: <span className="font-mono">usuario MP #{String(mpUserId)}</span></p>
              {mpConnectedAt && (
                <p className="text-muted-foreground mt-0.5">
                  Conectada el {new Date(mpConnectedAt).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}
            </div>
          </div>

          <div className="text-xs text-muted-foreground bg-green-50 border border-green-100 rounded-lg px-3 py-2.5">
            <p className="font-semibold text-green-800 mb-1">¿Qué pasa cuando alguien te paga online?</p>
            <p>La plata entra directo a tu Mercado Pago, tu local aparece como cobrador, y el pedido se marca pagado en tu panel automáticamente.</p>
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
            <li>Se abre la página de Mercado Pago (azul).</li>
            <li>Iniciás sesión con tu usuario de siempre y tocás "Permitir".</li>
            <li>Listo — quedó conectado, nadie te pide nada más.</li>
          </ol>
          <a href="/api/mp/connect">
            <Button type="button" className="w-full bg-[#009EE3] hover:bg-[#0084c7] text-white font-semibold">
              Conectar con Mercado Pago
            </Button>
          </a>
          <p className="text-[10px] text-muted-foreground">
            El portal jamás ve ni guarda tu contraseña. Podés revocar esto en cualquier momento desde tu panel o desde tu Mercado Pago.
          </p>
        </div>
      )}
    </div>
  );
}
