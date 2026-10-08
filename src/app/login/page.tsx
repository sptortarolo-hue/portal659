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
  const [mode, setMode] = useState<"cuenta" | "equipo">("cuenta");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  // Equipo del local (usuario simple por comercio, sin email).
  const [store, setStore] = useState("");
  const [teamUser, setTeamUser] = useState("");
  const [teamPass, setTeamPass] = useState("");
  const [storeName, setStoreName] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") {
      setVerified(true);
      setMessage("Email verificado. Ya podés iniciar sesión.");
    } else if (params.get("error") === "invalid_confirmation") {
      setMessage("El enlace de confirmación es inválido o expiró.");
    }
    const tienda = params.get("tienda");
    if (tienda) {
      setStore(tienda);
      setMode("equipo");
    }
  }, []);

  // Identifica el comercio mientras se escribe (solo muestra el nombre).
  useEffect(() => {
    if (mode !== "equipo" || store.trim().length < 2) {
      setStoreName(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/auth/staff/login?store=${encodeURIComponent(store.trim())}`);
        const data = await res.json().catch(() => ({}));
        setStoreName(data.vendor?.store_name || null);
      } catch {
        setStoreName(null);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [store, mode]);

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

  async function handleTeamLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!store.trim() || !teamUser.trim() || !teamPass) {
      setMessage("Completá comercio, usuario y contraseña");
      return;
    }
    setLoading(true);
    setMessage("");
    const res = await fetch("/api/auth/staff/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ store: store.trim(), username: teamUser.trim(), password: teamPass }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error || "Error al iniciar sesión");
    } else {
      window.dispatchEvent(new Event("auth-changed"));
      const safeNext = next && next.startsWith("/") ? next : null;
      router.push(safeNext || "/vendor/dashboard");
    }
    setLoading(false);
  }

  return (
    <main className="container mx-auto px-4 py-20 max-w-md">
      <div className="flex flex-col items-center mb-8">
        <Logo markClassName="h-14 w-14 text-primary" />
        <p className="text-muted-foreground mt-3">
          Iniciá sesión para ver tus pedidos, favoritos y administrar tu comercio
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 mb-6">
        <button
          type="button"
          onClick={() => { setMode("cuenta"); setMessage(""); }}
          className={`rounded-lg py-2 text-sm font-medium transition-colors ${mode === "cuenta" ? "bg-background shadow" : "text-muted-foreground"}`}
        >
          Mi cuenta
        </button>
        <button
          type="button"
          onClick={() => { setMode("equipo"); setMessage(""); }}
          className={`rounded-lg py-2 text-sm font-medium transition-colors ${mode === "equipo" ? "bg-background shadow" : "text-muted-foreground"}`}
        >
          Soy del equipo
        </button>
      </div>

      {mode === "equipo" ? (
      <form onSubmit={handleTeamLogin} className="space-y-4">
        <div>
          <Label htmlFor="store">Comercio</Label>
          <Input
            id="store"
            type="text"
            placeholder="Nombre del local"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            autoCapitalize="none"
          />
          {storeName && <p className="text-xs text-green-600 mt-1">🏪 {storeName}</p>}
        </div>
        <div>
          <Label htmlFor="teamUser">Usuario</Label>
          <Input
            id="teamUser"
            type="text"
            placeholder="Tu usuario (ej: caja1)"
            value={teamUser}
            onChange={(e) => setTeamUser(e.target.value.toLowerCase().replace(/\s/g, ""))}
            autoCapitalize="none"
          />
        </div>
        <div>
          <Label htmlFor="teamPass">Contraseña</Label>
          <Input
            id="teamPass"
            type="password"
            placeholder="••••••••"
            value={teamPass}
            onChange={(e) => setTeamPass(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">Te la da el dueño del local (Configuración → Equipo).</p>
        </div>
        {message && <p className="text-sm text-red-600">{message}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Entrando..." : "Entrar al panel"}
        </Button>
      </form>
      ) : (
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
      )}
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
