"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const T24_DEFAULT_TEXT = "Hola {nombre}! Te recordamos tu turno de mañana a las {hora} en {store}. {link}";
const T2_DEFAULT_TEXT = "Hola {nombre}! Tu turno es hoy a las {hora}. Te esperamos en {store}. {link}";

/**
 * Recordatorios por WhatsApp con el número del comercio (relay Portal Wa Link).
 * T-24/T-2 y confirmación de turno salen por WA además de push.
 * Opt-out por comercio; sin relay vinculado no sale nada (cae a push).
 * Horarios y texto editables por comercio (defaults seguros).
 */
export function WaRemindersCard() {
  const [enabled, setEnabled] = useState(true);
  const [linked, setLinked] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Configurables
  const [t24Enabled, setT24Enabled] = useState(true);
  const [t24Hour, setT24Hour] = useState(18);
  const [t2Enabled, setT2Enabled] = useState(true);
  const [t2Hours, setT2Hours] = useState(2);
  const [t24Text, setT24Text] = useState("");
  const [t2Text, setT2Text] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendor/wa-status");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEnabled(data.waReminders !== false);
        setLinked(data.linked === true);
        setT24Enabled(data.reminderT24Enabled !== false);
        setT24Hour(typeof data.reminderT24Hour === "number" ? data.reminderT24Hour : 18);
        setT2Enabled(data.reminderT2Enabled !== false);
        setT2Hours(typeof data.reminderT2Hours === "number" ? data.reminderT2Hours : 2);
        setT24Text(data.reminderT24Text || "");
        setT2Text(data.reminderT2Text || "");
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

  async function saveConfig() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/vendor/wa-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reminder_t24_enabled: t24Enabled,
          reminder_t24_hour: t24Hour,
          reminder_t2_enabled: t2Enabled,
          reminder_t2_hours: t2Hours,
          reminder_t24_text: t24Text.trim() ? t24Text : null,
          reminder_t2_text: t2Text.trim() ? t2Text : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok ? "✅ Configuración guardada" : (data.error || "Error al guardar"));
    } catch {
      setMsg("Error de conexión");
    } finally {
      setBusy(false);
    }
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
    <Card className="p-4 space-y-4">
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

      {enabled && (
        <div className="space-y-4 border-t border-border pt-3">
          {/* T-24 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs font-medium">Recordatorio T-24 (día anterior)</Label>
              <Switch checked={t24Enabled} onCheckedChange={setT24Enabled} />
            </div>
            {t24Enabled && (
              <>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Hora del día anterior</Label>
                  <select
                    value={t24Hour}
                    onChange={(e) => setT24Hour(Number(e.target.value))}
                    className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Texto (variables: {"{nombre}"}, {"{hora}"}, {"{fecha}"}, {"{servicio}"}, {"{link}"})</Label>
                  <textarea
                    value={t24Text}
                    onChange={(e) => setT24Text(e.target.value)}
                    placeholder={T24_DEFAULT_TEXT}
                    className="w-full min-h-[60px] rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
                    rows={3}
                  />
                </div>
              </>
            )}
          </div>

          {/* T-2 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs font-medium">Recordatorio T-2 (horas antes)</Label>
              <Switch checked={t2Enabled} onCheckedChange={setT2Enabled} />
            </div>
            {t2Enabled && (
              <>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Horas antes del turno</Label>
                  <select
                    value={t2Hours}
                    onChange={(e) => setT2Hours(Number(e.target.value))}
                    className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
                  >
                    {[1, 2, 3, 6, 12, 24].map((h) => (
                      <option key={h} value={h}>{h}h antes</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Texto (variables: {"{nombre}"}, {"{hora}"}, {"{fecha}"}, {"{servicio}"}, {"{link}"})</Label>
                  <textarea
                    value={t2Text}
                    onChange={(e) => setT2Text(e.target.value)}
                    placeholder={T2_DEFAULT_TEXT}
                    className="w-full min-h-[60px] rounded-lg border border-input bg-background px-2 py-1.5 text-xs"
                    rows={3}
                  />
                </div>
              </>
            )}
          </div>

          <Button size="sm" variant="outline" className="w-full" onClick={saveConfig} disabled={busy}>
            {busy ? "Guardando…" : "Guardar configuración"}
          </Button>
        </div>
      )}

      <Button size="sm" variant="outline" className="w-full" onClick={test} disabled={busy}>
        {busy ? "Enviando..." : "Probar en mi WhatsApp"}
      </Button>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </Card>
  );
}
