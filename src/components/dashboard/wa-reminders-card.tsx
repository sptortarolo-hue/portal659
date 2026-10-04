"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";

/**
 * Recordatorios por WhatsApp con el número del comercio (relay Portal Wa Link).
 * T-24/T-2 y confirmación de turno salen por WA además de push.
 * Opt-out por comercio; sin relay vinculado no sale nada (cae a push).
 */
export function WaRemindersCard() {
  const [enabled, setEnabled] = useState(true);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/wa-status");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEnabled(data.waReminders !== false);
        setLinked(data.linked === true);
      }
    } catch { /* noop */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(v: boolean) {
    setEnabled(v);
    try {
      await fetch("/api/vendor/wa-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wa_reminders: v }),
      });
    } catch { /* noop */ }
  }

  async function test() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/wa-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true }),
      });
      const data = await res.json().catch(() => ({}));
      setMsg(data.error || "✅ Te llegó el WhatsApp de prueba a tu número.");
    } catch {
      setMsg("Error de conexión");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-sm">📲 Recordatorios por WhatsApp</p>
          <p className="text-xs text-muted-foreground">
            Confirmación al reservar + T-24 y T-2 desde tu número (solo de día).
            {linked === false && " Vinculá la app Portal Wa Link para activar."}
            {linked === true && " Relay vinculado ✅"}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={toggle} />
      </div>
      <Button size="sm" variant="outline" className="w-full" onClick={test} disabled={busy}>
        {busy ? "Enviando..." : "Probar en mi WhatsApp"}
      </Button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </Card>
  );
}
