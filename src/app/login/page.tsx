"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/logo";
type Mode = "password" | "magic";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("password");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  function validate(): boolean {
    const e: typeof errors = {};
    if (!email) e.email = "Ingresá tu email";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Email inválido";
    if (mode === "password" && !password) e.password = "Ingresá tu contraseña";
    else if (mode === "password" && password.length < 6) e.password = "Mínimo 6 caracteres";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setMessage("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || "Error al iniciar sesión");
    } else {
      router.push(
        data.session?.user?.user_metadata?.role === "vendor"
          ? "/vendor/dashboard"
          : "/"
      );
    }
    setLoading(false);
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setMessage("");

    const res = await fetch("/api/auth/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      const data = await res.json();
      setMessage(data.error || "Error al enviar link");
    } else {
      setMessage(
        "Revisá tu correo electrónico para completar el inicio de sesión."
      );
    }
    setLoading(false);
  }

  return (
    <main className="container mx-auto px-4 py-20 max-w-md">
      <div className="flex flex-col items-center mb-8">
        <Logo markClassName="h-14 w-14 text-primary" />
        <p className="text-muted-foreground mt-3">
          Iniciá sesión para administrar tu comercio y tus pedidos
        </p>
      </div>

      <form
        onSubmit={mode === "password" ? handlePasswordLogin : handleMagicLink}
        className="space-y-4"
      >
        <div>
          <Label htmlFor="email">Correo electrónico</Label>
          <Input
            id="email"
            type="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={errors.email ? "border-red-300" : ""}
          />
          {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
        </div>

        {mode === "password" && (
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
          </div>
        )}

        {message && (
          <p
            className={`text-sm ${
              message.includes("correo") || message.includes("Revisá")
                ? "text-green-600"
                : "text-red-600"
            }`}
          >
            {message}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading
            ? "Enviando..."
            : mode === "password"
            ? "Iniciar sesión"
            : "Enviar link de acceso"}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-4">
        {mode === "password" ? (
          <>
            ¿Prefieres un link mágico?{" "}
            <button
              type="button"
              onClick={() => setMode("magic")}
              className="text-primary underline hover:no-underline"
            >
              Enviar link al email
            </button>
          </>
        ) : (
          <>
            ¿Tenés contraseña?{" "}
            <button
              type="button"
              onClick={() => setMode("password")}
              className="text-primary underline hover:no-underline"
            >
              Iniciar sesión con contraseña
            </button>
          </>
        )}
      </p>
    </main>
  );
}