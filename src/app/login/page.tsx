"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/logo";
import { GoogleButton } from "@/components/auth/google-button";
import { checkArgPhone } from "@/lib/phone";

// Errores del callback de Google (?error=...) traducidos a mensajes humanos.
const GOOGLE_ERRORS: Record<string, string> = {
  google_disabled: "El ingreso con Google no está disponible en este momento.",
  google_cancelled: "Cancelaste el ingreso con Google.",
  google_state: "La sesión de Google expiró. Probá de nuevo.",
  google_exchange: "No pudimos completar el ingreso con Google. Probá de nuevo.",
  google_token: "No pudimos verificar tu cuenta de Google. Probá de nuevo.",
  google_conflict: "Ese email ya está vinculado a otra cuenta de Google. Entrá con tu contraseña.",
  google_staff: "Las cuentas del equipo del local entran con usuario y contraseña (\"Soy del equipo\"), no con Google.",
  google_migration: "El ingreso con Google todavía no está habilitado en el servidor.",
  google_error: "No pudimos completar el ingreso con Google. Probá de nuevo.",
};

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
  const [pending2fa, setPending2fa] = useState<string | null>(searchParams.get("pending"));
  const [totpCode, setTotpCode] = useState("");
  const [verifying2fa, setVerifying2fa] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  // Equipo del local (usuario simple por comercio, sin email).
  const [store, setStore] = useState("");
  const [teamUser, setTeamUser] = useState("");
  const [teamPass, setTeamPass] = useState("");
  const [storeName, setStoreName] = useState<string | null>(null);
  const [storeCandidates, setStoreCandidates] = useState<{ id: string; store_name: string; logo_url: string | null; slug: string }[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("error") || "";
    if (params.get("verified") === "1") {
      setVerified(true);
      setMessage("Email verificado. Ya podés iniciar sesión.");
    } else if (errorCode === "invalid_confirmation") {
      setMessage("El enlace de confirmación es inválido o expiró.");
    } else if (GOOGLE_ERRORS[errorCode]) {
      setMessage(GOOGLE_ERRORS[errorCode]);
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
        const cands = Array.isArray(data.vendors) ? data.vendors : (data.vendor ? [data.vendor] : []);
        setStoreCandidates(cands);
        if (cands.length === 1) {
          // Auto-rellenar el campo con el nombre sugerido (único match).
          setStore(cands[0].store_name);
          setStoreName(cands[0].store_name);
        } else if (cands.length > 1) {
          setStoreName(cands[0]?.store_name || null);
        } else {
          setStoreName(null);
        }
      } catch {
        setStoreCandidates([]);
        setStoreName(null);
      }
    }, 300);
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
        setMessage(data.message || data.error || "Error al iniciar sesión");
      }
    } else if (data.need2fa && data.pendingToken) {
      // Desafío 2FA: no hay sesión todavía, pedimos el código TOTP.
      setPending2fa(data.pendingToken);
    } else {
      window.dispatchEvent(new Event("auth-changed"));
      const role = data.user?.role;
      const safeNext = next && next.startsWith("/") ? next : null;
      router.push(safeNext || (role === "vendor" ? "/vendor/dashboard" : "/"));
    }
    setLoading(false);
  }

  async function handleTotpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pending2fa) return;
    const clean = totpCode.replace(/\\D/g, "");
    if (clean.length !== 6) {
      setMessage("Ingresá el código de 6 dígitos.");
      return;
    }
    setVerifying2fa(true);
    setMessage("");
    try {
      const res = await fetch("/api/auth/2fa/verify-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken: pending2fa, code: clean }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Código inválido");
      } else {
        window.dispatchEvent(new Event("auth-changed"));
        const role = data.user?.role;
        const safeNext = next && next.startsWith("/") ? next : null;
        router.push(safeNext || (role === "vendor" ? "/vendor/dashboard" : "/"));
      }
    } catch {
      setMessage("Error al verificar el código.");
    }
    setVerifying2fa(false);
  }

  function handleCancel2fa() {
    setPending2fa(null);
    setTotpCode("");
    setMessage("");
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
      // El equipo no navega el sitio público: siempre a su panel (el `next`
      // de la URL es para compradores/dueños; ver src/proxy.ts).
      router.push("/vendor/dashboard");
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

      {pending2fa ? (
      <form onSubmit={handleTotpSubmit} className="space-y-4">
        <div className="text-sm text-muted-foreground">
          Verificación en dos pasos. Abrí tu app autenticadora (Google
          Authenticator, Authy, etc.) e ingresá el código de 6 dígitos.
        </div>
        <div>
          <Label htmlFor="totp">Código de 6 dígitos</Label>
          <Input
            id="totp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\\D/g, "").slice(0, 6))}
            className="text-center text-2xl tracking-widest font-mono"
            autoFocus
          />
        </div>
        {message && <p className="text-sm text-red-600">{message}</p>}
        <Button type="submit" className="w-full" disabled={verifying2fa || totpCode.length !== 6}>
          {verifying2fa ? "Verificando..." : "Verificar"}
        </Button>
        <button
          type="button"
          onClick={handleCancel2fa}
          className="w-full text-sm text-muted-foreground hover:text-foreground"
        >
          Cancelar y volver
        </button>
      </form>
      ) : mode === "equipo" ? (
      <form onSubmit={handleTeamLogin} className="space-y-4">
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Si trabajás en un comercio (caja, cocina, mostrador) entrá con el usuario que te dio el
          dueño. Google es solo para cuentas personales y dueños de comercio.
        </p>
        <div>
          <Label htmlFor="store">Comercio</Label>
          <div className="relative">
            <Input
              id="store"
              type="text"
              placeholder="Nombre del local"
              value={store}
              onChange={(e) => setStore(e.target.value)}
              autoCapitalize="none"
              autoComplete="off"
            />
            {storeCandidates.length > 1 && (
              <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-background shadow-lg max-h-48 overflow-y-auto">
                {storeCandidates.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setStore(v.store_name);
                      setStoreCandidates([]);
                      setStoreName(v.store_name);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                  >
                    {v.logo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.logo_url} alt="" className="h-6 w-6 rounded object-cover" />
                    )}
                    <span className="truncate">{v.store_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {storeName && storeCandidates.length <= 1 && (
            <p className="text-xs text-green-600 mt-1">🏪 {storeName}</p>
          )}
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
      <>
        <div className="mb-6">
          <GoogleButton
            next={next}
            hint="Si tu comercio ya está en Portal 659 con este email, entrás directo a tu panel."
          />
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
      </>
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
