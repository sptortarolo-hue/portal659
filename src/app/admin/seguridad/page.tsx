"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

export default function AdminSeguridadPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qr: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/2fa/status");
      const data = await res.json();
      if (res.ok) setEnabled(data.enabled === true);
      else setMsg({ kind: "err", text: data.error || "No se pudo leer el estado" });
    } catch {
      setMsg({ kind: "err", text: "Error de red" });
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSetup() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/2fa/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error || "Error al generar el QR" });
      } else {
        setSetup({ secret: data.secret, otpauthUrl: data.otpauthUrl, qr: data.qr });
      }
    } catch {
      setMsg({ kind: "err", text: "Error de red" });
    }
    setBusy(false);
  }

  async function handleEnable() {
    if (code.replace(/\D/g, "").length !== 6) {
      setMsg({ kind: "err", text: "Ingresá el código de 6 dígitos." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.replace(/\D/g, "") }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error || "Código inválido" });
      } else {
        setMsg({ kind: "ok", text: "Verificación en dos pasos activada." });
        setSetup(null);
        setCode("");
        await refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "Error de red" });
    }
    setBusy(false);
  }

  async function handleDisable() {
    if (!password) {
      setMsg({ kind: "err", text: "Ingresá tu contraseña para desactivar." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ kind: "err", text: data.error || "No se pudo desactivar" });
      } else {
        setMsg({ kind: "ok", text: "Verificación en dos pasos desactivada." });
        setPassword("");
        await refresh();
      }
    } catch {
      setMsg({ kind: "err", text: "Error de red" });
    }
    setBusy(false);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Seguridad — 2FA (TOTP)</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verificación en dos pasos para cuentas de administrador. Compatible con
          Google Authenticator, Authy, 1Password, etc. (RFC 6238).
        </p>
      </div>

      {msg && (
        <div
          className={`text-sm rounded-lg px-3 py-2 ${
            msg.kind === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando estado...</p>
      ) : enabled ? (
        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
            <span className="font-medium">Verificación en dos pasos: ACTIVADA</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Para desactivarla ingresá tu contraseña. Si perdiste el autenticador,
            desactivá desde la base de datos con el rollback del archivo
            <code className="mx-1">supabase/self-host/migrate-2fa-totp.sql</code>.
          </p>
          <div className="space-y-2">
            <Label htmlFor="pwd">Contraseña</Label>
            <Input
              id="pwd"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
          <Button onClick={handleDisable} disabled={busy} variant="destructive">
            {busy ? "Desactivando..." : "Desactivar 2FA"}
          </Button>
        </Card>
      ) : setup ? (
        <Card className="p-4 space-y-4">
          <p className="text-sm font-medium">
            1) Escaneá este QR con tu app autenticadora:
          </p>
          {setup.qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={setup.qr} alt="QR 2FA" className="mx-auto" />
          ) : (
            <p className="text-xs text-muted-foreground">No se pudo generar el QR. Usá el código manual.</p>
          )}
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Código manual (si no podés escanear):</p>
            <code className="block text-xs break-all bg-muted px-2 py-1 rounded">{setup.secret}</code>
          </div>
          <div className="space-y-2">
            <Label htmlFor="code">2) Ingresá el código de 6 dígitos que muestra la app</Label>
            <Input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="text-center text-2xl tracking-widest font-mono"
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleEnable} disabled={busy || code.length !== 6}>
              {busy ? "Activando..." : "Activar 2FA"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setSetup(null);
                setCode("");
              }}
              disabled={busy}
            >
              Cancelar
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-400" />
            <span className="font-medium">Verificación en dos pasos: DESACTIVADA</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Generá un QR para escanear con tu app autenticadora. El secreto anterior
            (si existía) se sobrescribe.
          </p>
          <Button onClick={handleSetup} disabled={busy}>
            {busy ? "Generando..." : "Activar 2FA"}
          </Button>
        </Card>
      )}
    </div>
  );
}
