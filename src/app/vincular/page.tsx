"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function VincularInner() {
  const router = useRouter();
  const params = useSearchParams();
  const codeFromUrl = (params.get("code") || "").toUpperCase();

  const [code, setCode] = useState(codeFromUrl);
  const [phone, setPhone] = useState("");
  const [storeName, setStoreName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [infoLoaded, setInfoLoaded] = useState(false);

  // Si llegamos con ?code=XXX, pre-cargamos comercio + teléfono.
  useEffect(() => {
    if (!codeFromUrl || infoLoaded) return;
    (async () => {
      try {
        const res = await fetch(`/api/auth/repartidor/info?code=${encodeURIComponent(codeFromUrl)}`);
        const data = await res.json();
        if (data.ok) {
          setStoreName(data.storeName || "");
          setPhone(data.phone || "");
          if (data.used) {
            setMsg("Ya te vinculaste antes. Entrá con tu teléfono y contraseña, o pedile un código nuevo a tu comercio.");
            setMsgOk(true);
          }
        } else {
          setMsg(data.error || "Código inválido");
        }
      } catch {
        /* noop */
      } finally {
        setInfoLoaded(true);
      }
    })();
  }, [codeFromUrl, infoLoaded]);

  const isClaim = !!code.trim();

  async function submit() {
    setLoading(true);
    setMsg("");
    setMsgOk(false);

    if (isClaim) {
      if (password.length < 6) {
        setMsg("La contraseña debe tener al menos 6 caracteres");
        setLoading(false);
        return;
      }
      if (password !== confirm) {
        setMsg("Las contraseñas no coinciden");
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/auth/repartidor/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, phone, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          setMsgOk(true);
          setMsg(`¡Listo! Sos repartidor de ${data.vendor?.store_name || "tu comercio"}.`);
          setTimeout(() => router.push("/vendor/dashboard"), 800);
        } else {
          setMsg(data.error || "No se pudo vincular");
        }
      } catch {
        setMsg("Error de conexión");
      }
    } else {
      try {
        const res = await fetch("/api/auth/repartidor/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.ok) {
          setMsgOk(true);
          setMsg("¡Hola de nuevo!");
          setTimeout(() => router.push("/vendor/dashboard"), 500);
        } else {
          setMsg(data.error || "No se pudo entrar");
        }
      } catch {
        setMsg("Error de conexión");
      }
    }
    setLoading(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6">
        <div className="text-center mb-5">
          <div className="text-4xl mb-2">🛵</div>
          <h1 className="font-display text-xl font-semibold">
            {isClaim ? "Unite como repartidor" : "Acceso del repartidor"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isClaim
              ? storeName
                ? `Te agregó ${storeName}. Elegí tu contraseña para entrar.`
                : "Ingresá tu código para elegir contraseña."
              : "Entrá con tu teléfono y contraseña."}
          </p>
        </div>

        <div className="space-y-3">
          {isClaim && (
            <div>
              <Label>Código</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={6}
                className="font-mono tracking-[0.2em] uppercase"
              />
            </div>
          )}

          <div>
            <Label>Teléfono</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Ej. 221 555 1234"
              inputMode="tel"
            />
          </div>

          <div>
            <Label>{isClaim ? "Elegí una contraseña" : "Contraseña"}</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>

          {isClaim && (
            <div>
              <Label>Repetí la contraseña</Label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
          )}

          <Button className="w-full" onClick={submit} disabled={loading}>
            {loading
              ? "Procesando..."
              : isClaim
                ? "Vincular y entrar"
                : "Entrar"}
          </Button>
        </div>

        {msg && (
          <p className={`text-sm mt-3 text-center ${msgOk ? "text-green-600" : "text-red-500"}`}>{msg}</p>
        )}

        <div className="mt-5 border-t border-border pt-3 text-center">
          {isClaim ? (
            <button type="button" onClick={() => { setCode(""); setPassword(""); setConfirm(""); setMsg(""); }} className="text-xs text-muted-foreground hover:text-primary">
              Ya tengo cuenta de repartidor → entrar con teléfono y contraseña
            </button>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              ¿Olvidaste tu contraseña o te quedaste sin código? Pedile a tu comercio
              que te regenere el código.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

export default function VincularPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-muted-foreground">Cargando...</div>}>
      <VincularInner />
    </Suspense>
  );
}