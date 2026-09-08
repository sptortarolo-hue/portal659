"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/logo";
import { checkArgPhone } from "@/lib/phone";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") {
      setVerified(true);
      setMessage("Email verificado. Ya podés iniciar sesión.");
    } else if (params.get("error") === "invalid_confirmation") {
      setMessage("El enlace de confirmación es inválido o expiró.");
    }
  }, []);

  function validate(): boolean {
    const e: typeof errors = {};
    if (!email) {
      e.email = "Ingresá tu email o WhatsApp";
    } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      // email válido
    } else if (!email.includes("@")) {
      // WhatsApp: debe ser un celular argentino válido
      const c = checkArgPhone(email);
      if (!c.ok) e.email = "WhatsApp inválido (celular)";
    } else {
      e.email = "Email inválido";
    }
    if (!password) e.password = "Ingresá tu contraseña";
    else if (password.length < 6) e.password = "Mínimo 6 caracteres";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setMessage("");
    setNeedsConfirmation(false);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.error === "confirm_email") {
        setNeedsConfirmation(true);
        setMessage(data.message || "Confirmá tu email para poder iniciar sesión.");
      } else {
        setMessage(data.error || "Error al iniciar sesión");
      }
    } else {
      window.dispatchEvent(new Event("auth-changed"));
      const role = data.user?.role;
      const safeNext = next && next.startsWith("/") ? next : null;
      router.push(safeNext || (role === "vendor" ? "/vendor/dashboard" : "/"));
    }
    setLoading(false);
  }

  async function handleResend() {
    if (!email) {
      setResendMsg("Ingresá tu email para reenviar el enlace.");
      return;
    }
    setResending(true);
    setResendMsg("");
    const res = await fetch("/api/auth/resend-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    await res.json();
    setResendMsg("Te enviamos un nuevo enlace de confirmación. Revisá tu email.");
    setResending(false);
  }

  return (
    <main className="container mx-auto px-4 py-20 max-w-md">
      <div className="flex flex-col items-center mb-8">
        <Logo markClassName="h-14 w-14 text-primary" />
        <p className="text-muted-foreground mt-3">
          Iniciá sesión para ver tus pedidos, favoritos y administrar tu comercio
        </p>
      </div>

      <form onSubmit={handleLogin} className="space-y-4">
        <div>
          <Label htmlFor="email">Correo electrónico o WhatsApp</Label>
          <Input
            id="email"
            type="text"
            placeholder="tu@email.com o 11 5555 1234"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={errors.email ? "border-red-300" : ""}
          />
          {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
        </div>

        <div>
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={errors.password ? "border-red-300" : ""}
          />
          {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password}</p>}
          <Link href="/recuperar" className="text-xs text-primary hover:underline mt-1 inline-block">
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        {message && (
          <p className={`text-sm ${verified || resendMsg ? "text-green-600" : "text-red-600"}`}>{message}</p>
        )}

        {needsConfirmation && (
          <div className="text-sm">
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="text-primary underline hover:no-underline disabled:opacity-60"
            >
              {resending ? "Reenviando..." : "¿No te llegó el mail? Reenviar verificación"}
            </button>
            {resendMsg && <p className="text-green-600 mt-1">{resendMsg}</p>}
          </div>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Iniciando sesión..." : "Iniciar sesión"}
        </Button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
