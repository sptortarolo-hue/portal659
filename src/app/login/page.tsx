"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "password" | "magic";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("password");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const supabase = getSupabase();

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setMessage("Error: no se pudo conectar");
      return;
    }
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      router.push("/");
    }
    setLoading(false);
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setMessage("Error: no se pudo conectar");
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
      },
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage(
        "Revisá tu correo electrónico para completar el inicio de sesión."
      );
    }
    setLoading(false);
  }

  return (
    <main className="container mx-auto px-4 py-20 max-w-md">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold">conectaMOS</h1>
        <p className="text-gray-600 mt-2">
          Iniciá sesión para comprar, publicar y vender
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
            required
          />
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
              required
            />
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

      <p className="text-center text-sm text-gray-500 mt-4">
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