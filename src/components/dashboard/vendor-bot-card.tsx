"use client";

import { useCallback, useEffect, useState } from "react";

type BotStatus = {
  name: string | null;
  mode: string;
  enabled: boolean;
  linked: boolean;
  connected: boolean;
  lastSeen: string | null;
  messagesDay: number;
  handoffsDay: number;
  configured: boolean;
};

/** Card de solo lectura para el dueño: ve su bot, no lo configura (Fase 1). */
export function VendorBotCard() {
  const [s, setS] = useState<BotStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/vendor/bot/status");
      if (r.ok) setS(await r.json());
    } catch { /* silencioso */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!s) return null;

  const state = s.connected ? "🟢 Conectado" : s.linked ? "🟡 Vinculado, sin señal" : "⚪ Sin vincular";
  return (
    <div className="mb-3 rounded-xl border border-border bg-card p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="font-semibold">🤖 Tu asistente de WhatsApp</span>
      <span className="text-muted-foreground">{state}</span>
      <span className="text-muted-foreground">
        Modo: <strong>{s.mode === "orders" ? "Órdenes" : "Conserje"}</strong>
        {s.enabled ? " · activo" : " · apagado"}
      </span>
      <span className="text-muted-foreground">
        {s.messagesDay} mensajes hoy · {s.handoffsDay} derivaciones
      </span>
      <span className="ml-auto text-[10px] text-muted-foreground/70">
        ¿Querés cambiar algo? Pedíselo a Portal 659.
      </span>
    </div>
  );
}
