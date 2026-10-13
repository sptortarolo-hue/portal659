"use client";

import { useEffect, useState } from "react";
import { GiftcardsManager } from "@/components/dashboard/giftcards-manager";
import { EsteticaGiftcardsManager } from "@/components/dashboard/estetica-managers";

type Summary = {
  total: number;
  active: number;
  issued: number;
  redeemed: number;
  outstanding: number;
  soldViaOrders: number;
  soldViaOrdersCount: number;
};

/**
 * Pestaña Tarjetas (comercio/moda/estética): resumen + emisión/canje +
 * montos + historial por tarjeta. Sin gate de plan (como el resto del
 * módulo): solo importa el vertical.
 */
export function GiftcardsTab({
  vertical,
  storeName,
}: {
  vertical: string | null | undefined;
  storeName: string;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    fetch("/api/vendor/giftcards/summary")
      .then((r) => r.json())
      .then((d) => {
        if (d && !d.migrationMissing) setSummary(d as Summary);
      })
      .catch(() => {});
  }, []);

  if (vertical === "estetica") {
    return (
      <div className="space-y-4">
        <EsteticaGiftcardsManager />
      </div>
    );
  }

  const codeHint = vertical === "comercio" ? "COM-XXXXXX" : "MOD-XXXXXX";
  const fmt = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">Vendidas por pedido</p>
            <p className="font-display text-lg font-bold tabular-nums">{fmt(summary.soldViaOrders)}</p>
            <p className="text-[11px] text-muted-foreground">{summary.soldViaOrdersCount} tarjeta(s)</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">Emitido total</p>
            <p className="font-display text-lg font-bold tabular-nums">{fmt(summary.issued)}</p>
            <p className="text-[11px] text-muted-foreground">{summary.total} tarjeta(s)</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">Canjeado</p>
            <p className="font-display text-lg font-bold tabular-nums">{fmt(summary.redeemed)}</p>
            <p className="text-[11px] text-muted-foreground">descontado en ventas</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-[11px] text-muted-foreground">Saldo pendiente</p>
            <p className="font-display text-lg font-bold tabular-nums">{fmt(summary.outstanding)}</p>
            <p className="text-[11px] text-muted-foreground">{summary.active} activa(s)</p>
          </div>
        </div>
      )}
      <GiftcardsManager codeHint={codeHint} showDenominations storeName={storeName} />
      <p className="text-xs text-muted-foreground">
        Al cobrar una tarjeta vendida (pedido o mostrador) el código se genera solo.
        Tocá una tarjeta para ver su historial y reenviarla por WhatsApp.
      </p>
    </div>
  );
}
